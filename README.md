# Fantasy Basketball Draft Scheduling

League members open the site, enter their name, tap every time they can make the draft, and hit Confirm.
The commissioner sees the most picked times at `/results` (needs the results key).

- `public/index.html` - the picker
- `public/results.html` - commissioner results
- `public/slots.js` - draft dates and time options
- `api/submit.js`, `api/results.js` - save and read picks (Vercel Blob)

Hosted on Vercel. Needs a Blob store connected to the project (`BLOB_READ_WRITE_TOKEN`).
