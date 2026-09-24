/**
 * Renders one JSON-LD `<script>` block. `<` is escaped in the serialized
 * JSON so a value containing a literal `</script>` (an admin-authored
 * product name or description, eventually) can never break out of the
 * script tag — the same defensive escaping every JSON-in-HTML embed needs,
 * `dangerouslySetInnerHTML` included.
 */
export function StructuredData({ data }: { data: Record<string, unknown> }) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
