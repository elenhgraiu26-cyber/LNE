import {
  consumeRateLimit,
  corsHeaders,
  getAuthenticatedUser,
  isOptions,
  jsonResponse,
  rateLimitSubject,
  readJson,
  serviceClient
} from "../_shared/security.ts";

type Listing = {
  id: string;
  title: string;
  location: string;
  status: string;
  owner_id: string | null;
  rejection_reason: string | null;
};

function boundedText(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

async function deliverEmail(templateParams: Record<string, string>): Promise<void> {
  const serviceId = Deno.env.get("EMAILJS_SERVICE_ID");
  const templateId = Deno.env.get("EMAILJS_TEMPLATE_ID");
  const publicKey = Deno.env.get("EMAILJS_PUBLIC_KEY");
  const privateKey = Deno.env.get("EMAILJS_PRIVATE_KEY");
  if (!serviceId || !templateId || !publicKey || !privateKey || !Deno.env.get("AGENCY_EMAIL")) {
    throw new Error("Email delivery is not configured on this server.");
  }
  const response = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      service_id: serviceId,
      template_id: templateId,
      user_id: publicKey,
      accessToken: privateKey,
      template_params: templateParams
    }),
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) {
    console.error(`Email provider returned HTTP ${response.status}.`);
    throw new Error("The email provider could not send this message.");
  }
}

Deno.serve(async (request) => {
  const cors = corsHeaders(request);
  if (!cors) return new Response("Origin not allowed.", { status: 403 });
  if (isOptions(request)) return new Response("ok", { headers: cors });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405, cors);

  try {
    const body = await readJson(request);
    const event = body.event;
    const auth = await getAuthenticatedUser(request);
    if (!auth.user && event !== "contact-request") {
      return jsonResponse({ error: auth.error || "Sign-in is required." }, 401, cors);
    }
    const subject = await rateLimitSubject(request, auth.user?.id);
    if (!await consumeRateLimit(subject, "email-minute", 8, 60)
      || !await consumeRateLimit(subject, "email-hour", 40, 3600)) {
      return jsonResponse({ error: "Email request limit reached. Try again later." }, 429, cors);
    }

    const agencyEmail = Deno.env.get("AGENCY_EMAIL");
    if (!agencyEmail) return jsonResponse({ error: "Email delivery is not configured." }, 503, cors);

    let recipient = agencyEmail;
    let notificationType = "";
    let title = "";
    let location = "";
    let reason = "";
    let criteria = "";
    let viewingDate = "";
    let viewingTime = "";
    let message = "";
    let listing: Listing | null = null;
    let claimedEvent: string | null = null;

    if (event === "submitted" || event === "approved" || event === "rejected") {
      if (!auth.user) return jsonResponse({ error: "Sign-in is required." }, 401, cors);
      const user = auth.user;
      const listingId = boundedText(body.listing_id, 120);
      if (!listingId) return jsonResponse({ error: "A listing ID is required." }, 400, cors);
      const { data, error } = await serviceClient.from("listings")
        .select("id,title,location,status,owner_id,rejection_reason")
        .eq("id", listingId)
        .maybeSingle();
      if (error) throw error;
      listing = data as Listing | null;
      if (!listing || !listing.owner_id) return jsonResponse({ error: "Listing not found." }, 404, cors);
      title = listing.title;
      location = listing.location;
      reason = listing.rejection_reason || "";

      if (event === "submitted") {
        if (listing.owner_id !== user.id || listing.status !== "pending") {
          return jsonResponse({ error: "This submission cannot be emailed." }, 403, cors);
        }
        notificationType = "New listing submitted";
        message = `${title} — ${location}`;
      } else {
        const { data: profile, error: profileError } = await serviceClient.from("profiles")
          .select("role")
          .eq("id", user.id)
          .maybeSingle();
        if (profileError) throw profileError;
        if (profile?.role !== "admin" || listing.status !== event) {
          return jsonResponse({ error: "Only an administrator can send this status notification." }, 403, cors);
        }
        const { data: userData, error: userError } = await serviceClient.auth.admin.getUserById(listing.owner_id);
        if (userError) throw userError;
        if (!userData.user.email) return jsonResponse({ error: "The client has no email address." }, 409, cors);
        recipient = userData.user.email;
        notificationType = event === "approved" ? "Listing approved" : "Listing rejected";
        message = event === "rejected" && reason
          ? `${title} — ${location}\nReason: ${reason}`
          : `${title} — ${location}`;
      }

      claimedEvent = event;
      const { error: claimError } = await serviceClient.from("listing_email_notifications")
        .insert({ listing_id: listing.id, event });
      if (claimError?.code === "23505") {
        return jsonResponse({ sent: true, already_sent: true }, 200, cors);
      }
      if (claimError) throw claimError;
    } else if (event === "contact-request") {
      notificationType = boundedText(body.notification_type, 80) || "Client request";
      title = boundedText(body.property_title, 160);
      location = boundedText(body.property_location, 200);
      criteria = boundedText(body.search_criteria, 1200);
      viewingDate = boundedText(body.viewing_date, 40);
      viewingTime = boundedText(body.viewing_time, 20);
      message = boundedText(body.message, 1800);
      if (!message) return jsonResponse({ error: "A message is required." }, 400, cors);
    } else {
      return jsonResponse({ error: "Unsupported email event." }, 400, cors);
    }

    try {
      await deliverEmail({
        to_email: recipient,
        recipient_email: recipient,
        requester_email: auth.user?.email || boundedText(body.requester_email, 254),
        notification_type: notificationType,
        subject: notificationType,
        search_criteria: criteria,
        property_title: title,
        property_location: location,
        rejection_reason: reason,
        viewing_date: viewingDate,
        viewing_time: viewingTime,
        message
      });
    } catch (error) {
      if (claimedEvent && listing) {
        const { error: cleanupError } = await serviceClient.from("listing_email_notifications")
          .delete()
          .eq("listing_id", listing.id)
          .eq("event", claimedEvent);
        if (cleanupError) console.error("Email retry claim could not be released.", cleanupError);
      }
      throw error;
    }
    return jsonResponse({ sent: true }, 200, cors);
  } catch (error) {
    console.error("Email Edge Function failed.", error);
    const message = error instanceof Error ? error.message : "Email delivery failed.";
    const status = message.includes("JSON") || message.includes("too large") ? 400 : 500;
    return jsonResponse(
      { error: status === 500 ? "Email delivery failed. Please try again later." : message },
      status,
      cors
    );
  }
});
