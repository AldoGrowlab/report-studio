<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Design source of truth: docs/DESIGN.md

`docs/DESIGN.md` is the authoritative design document for this project. Before building any new feature or making a design decision, **read `docs/DESIGN.md` first** and make your work conform to it — its guiding principles, pipeline architecture, edge-case rulings, and technical decisions.

- If a request, plan, or implementation **conflicts** with `docs/DESIGN.md`, do NOT silently proceed. Flag the conflict explicitly, quote the relevant part of the doc, and raise it for discussion before continuing. The document wins unless the user decides to change it.
- When the design genuinely needs to evolve, update `docs/DESIGN.md` (and the build-status checklist in it) as part of the same change, so the doc stays the source of truth.
