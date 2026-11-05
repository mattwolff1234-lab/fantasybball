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

## Weekly recap and records

- `public/recap.html` - one page per matchup week: scoreboard with all-time head-to-head, awards, power rankings, a card per team and next week's preview. Picks any week, including the live one.
- `api/weekly.js` - the data for one week (`?week=N`, default the last finished week), read from ESPN.
- `public/recaps/<year>/week-<n>.json` - the written recap for a week (headline, intro, a paragraph per owner, preview). The page shows plain facts for a team with no paragraph.
- `api/records.js` - this season's games and matchups, merged into the all-time lists on the Records page.
- `lib/days.js` - one file per day of the season (lineups, points, waiver and trade moves), saved in Blob once final and shared by both endpoints.

A scheduled Claude task runs every Monday at 7:17 AM Eastern: it writes that week's recap file, pushes it, and leaves an email version in Gmail drafts.
