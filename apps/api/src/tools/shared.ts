import type { KnowledgeSearchRepository } from "@town/knowledge";

const MAX_OUTPUT_CHARS = 12_000;
const MAX_ITEM_TEXT_CHARS = 1_500;

function boundedSearchOutput(
  page: Awaited<ReturnType<KnowledgeSearchRepository["search"]>>,
): { output: string; completePage: boolean } {
  const items: typeof page.items = [];
  let truncated = false;
  let nextCursor =
    page.nextCursor !== null && page.nextCursor.length <= 4_096
      ? page.nextCursor
      : null;
  if (nextCursor !== page.nextCursor) truncated = true;
  const encode = () => JSON.stringify({ items, nextCursor, truncated });
  for (const item of page.items) {
    const candidate = {
      ...item,
      text: item.text.slice(0, MAX_ITEM_TEXT_CHARS),
    };
    const originalTextLength = candidate.text.length;
    items.push(candidate);
    if (encode().length <= MAX_OUTPUT_CHARS) {
      if (originalTextLength < item.text.length) truncated = true;
      continue;
    }
    items.pop();
    truncated = true;
    let low = 0;
    let high = originalTextLength;
    let best = "";
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      items.push({ ...candidate, text: candidate.text.slice(0, middle) });
      if (encode().length <= MAX_OUTPUT_CHARS) {
        best = candidate.text.slice(0, middle);
        items.pop();
        low = middle + 1;
      } else {
        items.pop();
        high = middle - 1;
      }
    }
    if (best.length > 0) items.push({ ...candidate, text: best });
    break;
  }
  const completePage = items.length === page.items.length;
  if (!completePage) {
    truncated = true;
    nextCursor = null;
  }
  let output = encode();
  if (output.length > MAX_OUTPUT_CHARS) {
    items.length = 0;
    truncated = true;
    nextCursor = null;
    output = encode();
  }
  return {
    output,
    completePage: completePage && (items.length > 0 || page.items.length === 0),
  };
}

export { MAX_OUTPUT_CHARS, MAX_ITEM_TEXT_CHARS, boundedSearchOutput };
