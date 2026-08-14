const VAPE_DB = {
  "flava": 10000,
  "flava nimmbox": 10000,
  "flava hyper bar": 10000,
  "flava hyper bar xtre": 10000,
  "flava friobar": 9500,
  "flava romio": 10000,
  "flava romio pilot": 10000,
  "flava black oxbar": 9500,
  "relx": 6000,
  "relx infinity": 6000,
  "relx pod pro": 6000,
  "hqd": 5000,
  "hqd cuvie": 1200,
  "hqd cuvie plus": 5000,
  "lana": 6000,
  "lana a8": 6000,
  "ziqi": 10000,
  "oxbar": 9500,
  "waka": 8000,
  "waka soul": 8000,
  "mokssa": 5000,
  "vmate": 5000
};

function lookupVapePuffs(query) {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  let bestMatch = null;
  for (const key in VAPE_DB) {
    if (q.includes(key)) {
      if (!bestMatch || key.length > bestMatch.length) bestMatch = key;
    }
  }
  return bestMatch ? { name: bestMatch, puffs: VAPE_DB[bestMatch] } : null;
}
