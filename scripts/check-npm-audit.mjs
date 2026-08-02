import { spawn } from 'node:child_process';

const reviewedAdvisory = 'GHSA-qwww-vcr4-c8h2';
const reviewedAdvisoryUrl = `https://github.com/advisories/${reviewedAdvisory}`;

const runAudit = () => new Promise((resolve, reject) => {
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const child = spawn(command, ['audit', '--json'], {
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('error', reject);
  child.on('close', code => resolve({ code, stdout, stderr }));
});

const { code, stdout, stderr } = await runAudit();
let report;

try {
  report = JSON.parse(stdout);
} catch {
  console.error('Dependency audit did not return valid JSON.');
  if (stderr.trim()) console.error(stderr.trim());
  process.exit(1);
}

if (report.auditReportVersion !== 2 || !report.vulnerabilities) {
  console.error('Dependency audit could not produce a version 2 vulnerability report.');
  if (report.error?.summary) console.error(report.error.summary);
  process.exit(1);
}

const vulnerabilities = report.vulnerabilities;
const unexpected = [];

for (const [name, vulnerability] of Object.entries(vulnerabilities)) {
  const allowedDirectAdvisory = name === 'react-router'
    && vulnerability.via.length > 0
    && vulnerability.via.every(item => (
      typeof item === 'object'
      && item !== null
      && item.url === reviewedAdvisoryUrl
    ));
  const allowedDependentPackage = name === 'react-router-dom'
    && vulnerability.via.length === 1
    && vulnerability.via[0] === 'react-router'
    && vulnerabilities['react-router'];

  if (!allowedDirectAdvisory && !allowedDependentPackage) {
    unexpected.push(`${name} (${vulnerability.severity})`);
  }
}

if (unexpected.length > 0) {
  console.error('Dependency audit found unreviewed vulnerabilities:');
  for (const item of unexpected.sort()) console.error(`- ${item}`);
  process.exit(1);
}

if (code !== 0 && Object.keys(vulnerabilities).length === 0) {
  console.error('Dependency audit failed without reporting vulnerabilities.');
  if (stderr.trim()) console.error(stderr.trim());
  process.exit(1);
}

if (Object.keys(vulnerabilities).length === 0) {
  console.log('Dependency audit passed with no known vulnerabilities.');
} else {
  console.log(
    `Dependency audit passed with reviewed exception ${reviewedAdvisory} `
    + `(${Object.keys(vulnerabilities).length} package records).`
  );
}
