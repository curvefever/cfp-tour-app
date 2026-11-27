/**
 * What the Custom bracket's parser and checks return, and the steps of a live graph edit: the value, or the message
 * that refuses the graph or the save. A file of its own, importing nothing, so that every graph file can name it
 * without an import loop.
 */
export type WaterfallParseResult<T> = { ok: true; value: T } | { ok: false; error: string };
