# Gmail DOM fixtures

Hand-written, anonymized approximations of the Gmail conversation DOM, built
from the class names the parser relies on (`h2.hP`, `div.adn`, `.a3s`, `.gD`,
`.g3`, `.gmail_quote`). They contain no real mail.

They prove the parser's logic, not that today's Gmail still matches. If Gmail
changes its markup, capture a fresh sanitized snapshot, replace the personal data
with `example.org` / `*.example` placeholders, and update these files and
`src/content/gmail-selectors.ts` together. The manual test in task 38 checks the
real site.
