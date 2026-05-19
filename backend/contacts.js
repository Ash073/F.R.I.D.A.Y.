// Hardcoded contact list — replace with DB/file later
const CONTACTS = [
  { id: 1,  name: "Tony Stark",    phone: "+1-555-0101", alias: ["tony", "stark"] },
  { id: 2,  name: "Natasha Romanoff", phone: "+1-555-0102", alias: ["natasha", "nat", "romanoff"] },
  { id: 3,  name: "Bruce Banner",  phone: "+1-555-0103", alias: ["bruce", "banner", "hulk"] },
  { id: 4,  name: "Steve Rogers",  phone: "+1-555-0104", alias: ["steve", "rogers", "cap"] },
  { id: 5,  name: "Thor Odinson",  phone: "+1-555-0105", alias: ["thor"] },
];

// Match by name or alias (case-insensitive, partial ok)
function findContacts(query) {
  const q = query.toLowerCase().trim();
  return CONTACTS.filter(c =>
    c.name.toLowerCase().includes(q) ||
    c.alias.some(a => a.includes(q))
  );
}

module.exports = { CONTACTS, findContacts };
