"""Check tracked files without logging secret values. Python 3.10+, Git required."""
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
BLOCKED_DIRS = {'.private', '.vs', '.expo', 'node_modules', 'bin', 'obj', 'publish',
                'builds', 'entregables', 'downloads', 'data-protection-keys', 'secrets', 'keys'}
BLOCKED_SUFFIXES = {'.p8', '.p12', '.pfx', '.pem', '.key', '.jks', '.keystore',
                    '.apk', '.aab', '.ipa', '.zip', '.rar', '.7z', '.bak', '.bacpac', '.mdf', '.ldf', '.dump'}
BLOCKED_NAMES = {'google-services.json', 'googleservice-info.plist', 'credentials.json',
                 'store.config.json', 'launchsettings.json'}
PATTERNS = {
    'private-key': re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----'),
    'google-key': re.compile(rb'AIza[0-9A-Za-z_-]{35}'),
    'github-token': re.compile(rb'(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})'),
    'aws-key': re.compile(rb'(?:AKIA|ASIA)[A-Z0-9]{16}'),
    'jwt-literal': re.compile(rb'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'),
    'basic-auth-url': re.compile(rb'https?://[^\s/"\x27]+:[^\s/"\x27]+@'),
}

def main():
    result = subprocess.run(['git', 'ls-files', '-z'], cwd=ROOT, capture_output=True, check=True)
    paths = [p.decode('utf-8') for p in result.stdout.split(b'\0') if p]
    if not paths:
        raise SystemExit('No tracked files found. Stage the intended files before checking.')
    failures = []
    for name in paths:
        path = PurePosixPath(name)
        lower = path.name.lower()
        blocked = any(part in BLOCKED_DIRS or part == 'dist' or part.startswith('dist-') for part in path.parts)
        blocked |= path.suffix.lower() in BLOCKED_SUFFIXES or lower in BLOCKED_NAMES
        blocked |= lower.startswith('.env') and lower != '.env.example'
        blocked |= lower.startswith('appsettings') and lower.endswith('.json') and lower != 'appsettings.example.json'
        blocked |= any(term in lower for term in ['service-account', 'service_account', 'firebase-adminsdk'])
        if blocked:
            failures.append(f'{name}: excluded-private-or-generated-file')
        # Read the staged blob, not just the working tree: the index is what gets committed.
        data = subprocess.run(['git', 'show', ':' + name], cwd=ROOT, capture_output=True, check=True).stdout
        for category, pattern in PATTERNS.items():
            for match in pattern.finditer(data):
                line = data.count(b'\n', 0, match.start()) + 1
                failures.append(f'{name}:{line}: {category}')
    for finding in failures:
        print(finding)
    print(f'Checked {len(paths)} tracked files; {len(failures)} blocking findings. Values are never printed.')
    return 1 if failures else 0

if __name__ == '__main__':
    sys.exit(main())
