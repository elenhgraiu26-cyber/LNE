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

const bucket = "listing-images";

async function listStorageEntries(path: string) {
  const entries = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await serviceClient.storage.from(bucket).list(path, {
      limit: 100,
      offset,
      sortBy: { column: "name", order: "asc" }
    });
    if (error) throw error;
    entries.push(...data);
    if (data.length < 100) return entries;
  }
}

async function removeUserImages(userId: string): Promise<void> {
  const folders = await listStorageEntries(userId);
  const paths: string[] = [];
  for (const entry of folders) {
    if (!entry.name || entry.name === ".emptyFolderPlaceholder") continue;
    if (entry.id) {
      paths.push(`${userId}/${entry.name}`);
      continue;
    }
    const files = await listStorageEntries(`${userId}/${entry.name}`);
    files.forEach((file) => {
      if (file.name && file.name !== ".emptyFolderPlaceholder") {
        paths.push(`${userId}/${entry.name}/${file.name}`);
      }
    });
  }
  for (let index = 0; index < paths.length; index += 100) {
    const { error } = await serviceClient.storage.from(bucket).remove(paths.slice(index, index + 100));
    if (error) throw error;
  }
}

Deno.serve(async (request) => {
  const cors = corsHeaders(request);
  if (!cors) return new Response("Origin not allowed.", { status: 403 });
  if (isOptions(request)) return new Response("ok", { headers: cors });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405, cors);

  try {
    await readJson(request, 1024);
    const auth = await getAuthenticatedUser(request);
    if (!auth.user) return jsonResponse({ error: auth.error || "Sign-in is required." }, 401, cors);
    const subject = await rateLimitSubject(request, auth.user.id);
    if (!await consumeRateLimit(subject, "account-deletion", 3, 3600)) {
      return jsonResponse({ error: "Account deletion was recently requested. Try again later." }, 429, cors);
    }

    await removeUserImages(auth.user.id);
    const { error: listingError } = await serviceClient.from("listings")
      .delete()
      .eq("owner_id", auth.user.id);
    if (listingError) throw listingError;

    const { error: deletionError } = await serviceClient.auth.admin.deleteUser(auth.user.id);
    if (deletionError) throw deletionError;
    return jsonResponse({ deleted: true }, 200, cors);
  } catch (error) {
    console.error("Account deletion failed.", error);
    const message = error instanceof Error ? error.message : "Account deletion failed.";
    const status = message.includes("JSON") || message.includes("too large") ? 400 : 500;
    return jsonResponse(
      { error: status === 500 ? "Account deletion could not be completed. Contact support." : message },
      status,
      cors
    );
  }
});
