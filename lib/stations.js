// Which line each station in the buildings table is on, with the line's colour.
// Only the stations our data uses; an unknown station falls back to its network with no colour.

const LINES = {
  sukhumvit: { name: "BTS Sukhumvit line", colour: "#7cb342" },
  silom: { name: "BTS Silom line", colour: "#00703c" },
  blue: { name: "MRT Blue line", colour: "#1e4d9c" },
};

const STATIONS = {
  "BTS Thong Lo": "sukhumvit", "BTS Ekkamai": "sukhumvit", "BTS Phrom Phong": "sukhumvit", "BTS Asok": "sukhumvit",
  "BTS Nana": "sukhumvit", "BTS Phra Khanong": "sukhumvit", "BTS On Nut": "sukhumvit", "BTS Ari": "sukhumvit",
  "BTS Victory Monument": "sukhumvit", "BTS Phaya Thai": "sukhumvit", "BTS Ratchathewi": "sukhumvit",
  "BTS Bang Na": "sukhumvit", "BTS Udom Suk": "sukhumvit", "BTS Punnawithi": "sukhumvit", "BTS Ha Yaek Lat Phrao": "sukhumvit",
  "BTS Chong Nonsi": "silom", "BTS Sala Daeng": "silom", "BTS Surasak": "silom", "BTS Saint Louis": "silom",
  "MRT Sukhumvit": "blue", "MRT Phra Ram 9": "blue", "MRT Phetchaburi": "blue", "MRT Phahon Yothin": "blue", "MRT Huai Khwang": "blue",
};

export function lineFor(station) {
  const s = String(station ?? "").trim();
  if (!s) return null;
  const key = STATIONS[s];
  if (key) return LINES[key];
  const network = s.split(" ")[0].toUpperCase();
  return { name: network, colour: null };
}
