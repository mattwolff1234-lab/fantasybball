// Draft window and time options. All times Eastern.
// Weekdays: 6, 7, 8 PM. Weekends: 1, 2, 3, 4 PM and 7, 8, 9 PM.
window.DRAFT = (function () {
  const START = new Date(2026, 9, 11); // Sun Oct 11, 2026
  const DAYS = 8;                      // through Sun Oct 18
  const WEEKDAY = [18, 19, 20];
  const WEEKEND = [13, 14, 15, 16, 19, 20, 21];
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const pad = n => String(n).padStart(2, "0");
  const hr = h => (h > 12 ? h - 12 : h) + (h >= 12 ? " PM" : " AM");
  const days = [];
  for (let i = 0; i < DAYS; i++) {
    const d = new Date(START); d.setDate(d.getDate() + i);
    const we = d.getDay() === 0 || d.getDay() === 6;
    days.push({ key: pad(d.getMonth() + 1) + pad(d.getDate()), dow: DOW[d.getDay()],
      label: (d.getMonth() + 1) + "/" + d.getDate(), weekend: we, hours: we ? WEEKEND : WEEKDAY });
  }
  const valid = new Set(days.flatMap(d => d.hours.map(h => d.key + "-" + h)));
  const label = id => { const [k, h] = id.split("-"); const d = days.find(x => x.key === k);
    return d ? d.dow + " " + d.label + ", " + hr(+h) : id; };
  return { days, hr, valid, label, LEAGUE: 12 };
})();
