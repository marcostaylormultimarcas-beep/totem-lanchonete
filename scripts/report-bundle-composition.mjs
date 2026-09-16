import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('dist/assets');
if (!fs.existsSync(root)) {
  console.error('dist/assets not found; run npm run build first');
  process.exit(1);
}

const files = fs.readdirSync(root)
  .filter((name) => name.endsWith('.js'))
  .map((name) => {
    const full = path.join(root, name);
    return { name, bytes: fs.statSync(full).size };
  })
  .sort((a, b) => b.bytes - a.bytes);

console.log('Largest JavaScript chunks:');
for (const file of files.slice(0, 20)) {
  console.log(`${(file.bytes / 1024).toFixed(2)} KiB\t${file.name}`);
}

const entry = files.find((f) => /^index-.*\.js$/.test(f.name));
if (entry) {
  const text = fs.readFileSync(path.join(root, entry.name), 'utf8');
  const markers = [
    ['supabase', ['supabase.co', 'realtime', 'postgrest', 'GoTrue']],
    ['tanstack-query', ['queryKey', 'QueryClient']],
    ['react-router', ['createBrowserRouter', 'useNavigate', 'BrowserRouter']],
    ['radix', ['radix', 'DismissableLayer', 'FocusScope']],
    ['lucide', ['lucide', 'createLucideIcon']],
    ['date-fns', ['date-fns', 'differenceIn', 'formatDistance']],
  ];
  console.log(`\nShared entry candidate: ${entry.name} (${(entry.bytes / 1024).toFixed(2)} KiB)`);
  console.log('Marker scan (diagnostic only):');
  for (const [label, needles] of markers) {
    const hits = needles.filter((needle) => text.includes(needle));
    console.log(`${label}: ${hits.length ? hits.join(', ') : 'no obvious marker'}`);
  }
}
