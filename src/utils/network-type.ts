// `surf network --type` names a response content type (json, html, proto, a MIME type or its
// subtype such as css) or a Chrome resource type (Document, XHR, Fetch, Script).
const MIME_ALIASES: Record<string, (mime: string) => boolean> = {
  json: (mime) => /(^|[/+])json$/.test(mime),
  html: (mime) => mime === "text/html" || mime === "application/xhtml+xml",
  proto: (mime) => /protobuf|grpc/.test(mime),
};

export function matchesNetworkType(item: { type?: string; mimeType?: string }, value: string): boolean {
  const wanted = value.trim().toLowerCase();
  const mime = (item.mimeType || "").split(";")[0].trim().toLowerCase();
  const alias = MIME_ALIASES[wanted];
  if (alias) return alias(mime);
  if (wanted.includes("/")) return mime.startsWith(wanted);
  return (item.type || "").toLowerCase() === wanted || mime.split("/")[1] === wanted;
}
