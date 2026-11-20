// Lane A implements this (see IMPLEMENTATION.md, "HTTP behaviour").
export async function DELETE(): Promise<Response> {
  return new Response("Not implemented", { status: 501 });
}
