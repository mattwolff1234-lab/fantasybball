# Fantasy Basketball Draft Scheduling

League members open the site, enter their name, tap every time they can make the draft, and hit Confirm.
After confirming they see the most picked times so far (counts only, no names).
The commissioner sees the most picked times at `/results` (needs the results key).

- `public/index.html` - the picker
- `public/results.html` - commissioner results
- `public/slots.js` - draft dates and time options
- `public/names.js` - league roster and typo matching (used by the picker and the API)
- `api/submit.js`, `api/results.js` - save and read picks (Vercel Blob)
- `api/standings.js` - public count per time, shown after Confirm
- `api/unlock.js` - commissioner only: lets someone send picks from a new device

A name is locked to the first device that sends picks for it, so nobody else can overwrite them.
The commissioner can unlock a name from `/results`.

Hosted on Vercel. Needs a Blob store connected to the project (`BLOB_READ_WRITE_TOKEN`).
