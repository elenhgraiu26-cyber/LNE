import {
  consumeRateLimit,
  corsHeaders,
  getAuthenticatedUser,
  isOptions,
  jsonResponse,
  rateLimitSubject,
  readJson
} from "../_shared/security.ts";

type Message = { role: "system" | "user" | "assistant"; content: string };

Deno.serve(async (request) => {
  const cors = corsHeaders(request);
  if (!cors) return new Response("Origin not allowed.", { status: 403 });
  if (isOptions(request)) return new Response("ok", { headers: cors });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405, cors);

  try {
    const body = await readJson(request);
    const provider = body.provider;
    if (provider !== "openai" && provider !== "gemini") {
      return jsonResponse({ error: "Choose OpenAI or Gemini." }, 400, cors);
    }
    if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 10) {
      return jsonResponse({ error: "The message list is invalid." }, 400, cors);
    }
    const messages = body.messages as Message[];
    let totalCharacters = 0;
    for (const message of messages) {
      if (!message || !["system", "user", "assistant"].includes(message.role)
        || typeof message.content !== "string" || message.content.length > 12000) {
        return jsonResponse({ error: "A message is invalid." }, 400, cors);
      }
      totalCharacters += message.content.length;
    }
    if (totalCharacters > 24000) return jsonResponse({ error: "The request is too large." }, 413, cors);

    const auth = await getAuthenticatedUser(request);
    const subject = await rateLimitSubject(request, auth.user?.id);
    const minuteAllowed = await consumeRateLimit(subject, "ai-minute", 8, 60);
    const hourAllowed = minuteAllowed && await consumeRateLimit(subject, "ai-hour", 50, 3600);
    if (!hourAllowed) return jsonResponse({ error: "AI request limit reached. Try again later." }, 429, cors);

    let response: Response;
    if (provider === "openai") {
      const apiKey = Deno.env.get("OPENAI_API_KEY");
      if (!apiKey) return jsonResponse({ error: "OpenAI is not configured on this server." }, 503, cors);
      response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: "gpt-4o-mini", messages, temperature: 0.2 }),
        signal: AbortSignal.timeout(20000)
      });
    } else {
      const apiKey = Deno.env.get("GEMINI_API_KEY");
      if (!apiKey) return jsonResponse({ error: "Gemini is not configured on this server." }, 503, cors);
      const systemInstruction = messages.filter((message) => message.role === "system")
        .map((message) => message.content).join("\n");
      const contents = messages.filter((message) => message.role !== "system").map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }]
      }));
      if (systemInstruction && contents[0]) {
        contents[0].parts[0].text = `${systemInstruction}\n\n${contents[0].parts[0].text}`;
      }
      response = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({ contents, generationConfig: { temperature: 0.2 } }),
          signal: AbortSignal.timeout(20000)
        }
      );
    }

    if (!response.ok) {
      console.error(`AI provider returned HTTP ${response.status}.`);
      return jsonResponse({ error: "The AI provider could not complete this request." }, 502, cors);
    }
    const result = await response.json();
    const answer = provider === "gemini"
      ? result.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || "").join("")
      : result.choices?.[0]?.message?.content;
    const text = Array.isArray(answer)
      ? answer.map((part: { text?: string }) => part.text || "").join("").trim()
      : answer;
    if (typeof text !== "string" || !text.trim()) {
      return jsonResponse({ error: "The AI provider returned an empty response." }, 502, cors);
    }
    return jsonResponse({ text: text.trim() }, 200, cors);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The AI request failed.";
    const status = message.includes("too large") ? 413 : message.includes("JSON") ? 400 : 500;
    console.error("AI Edge Function failed.", error);
    return jsonResponse({ error: status === 500 ? "The AI service is temporarily unavailable." : message }, status, cors);
  }
});
