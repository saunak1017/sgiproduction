// Shared, dependency-free business rules. Stage indices are zero based.
export const STAGES = [
  'Project Created', 'Project Accepted by RFG', 'Stones Sent to RFG',
  'Stones Received by RFG', 'Casting', 'Setting',
  'Project Ready for Pickup', 'Received by Shivani'
];
export const STAMPS = ['Metal', 'SMS', 'CTTW', 'LGD', 'Other'];
export const FILE_GROUPS = { reference: 'Reference images', stl: 'STL files', '3dm': '3DM files' };
export const CHUNK_SIZE = 8 * 1024 * 1024;
export const MAX_FILE_SIZE = 100 * 1024 * 1024;
export const projectName = p => p.name || 'Untitled project';
export const projectRef = p => `SG-${String(p.number || '').padStart(4, '0')}`;
export const decimal = v => /^\d+(?:\.\d+)?$/.test(String(v).trim()) ? Number(v) : null;
export function stoneTotal(s) {
  const w = decimal(s.weight);
  if (w === null) return null;
  if (s.basis === 'total') return w;
  const q = decimal(s.quantity);
  return q === null ? null : Math.round(w * q * 1e6) / 1e6;
}
export const carats = v => v === null ? '—' : `${Number(v.toFixed(6))} ct`;
export function orderTotal(p) {
  const cost = decimal(p.cost);
  if (cost === null) return null;
  if (p.cost_basis === 'order') return cost;
  const qty = decimal(p.quantity);
  return qty === null ? null : Math.round(cost * qty * 100) / 100;
}
export const money = v => new Intl.NumberFormat('en-US', {style:'currency',currency:'USD'}).format(Number(v));
export function validDate(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T12:00:00Z`);
  return !Number.isNaN(+d) && d.toISOString().slice(0,10) === v && v >= '1900-01-01' && v <= '2199-12-31';
}
export function parseDateInput(value) {
  const v = value.trim();
  if (!v) return '';
  if (validDate(v)) return v;
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const iso = m ? `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}` : '';
  return validDate(iso) ? iso : null;
}
export function displayDate(v) {
  if (!v || !validDate(v)) return 'Not set';
  return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(`${v}T12:00:00Z`));
}
export function nyClock(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone:'America/New_York', year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',hourCycle:'h23'
  }).formatToParts(now).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
  return {date:`${parts.year}-${parts.month}-${parts.day}`,hour:Number(parts.hour),weekday:parts.weekday};
}
export function dueBucket(p, today = nyClock().date) {
  if (p.stage === 7 || !validDate(p.delivery_date)) return '';
  if (p.delivery_date < today) return 'overdue';
  const end = new Date(`${today}T12:00:00Z`); end.setUTCDate(end.getUTCDate()+2);
  return p.delivery_date <= end.toISOString().slice(0,10) ? 'soon' : '';
}
