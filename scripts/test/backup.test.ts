import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '../..');
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('backup → restore round trip (M7 acceptance)', () => {
  it('restores every save byte for byte and keeps the old data aside', () => {
    const t = mkdtempSync(join(tmpdir(), 'sw-bk-'));
    dirs.push(t);
    const data = join(t, 'data');
    mkdirSync(join(data, 'saves'), { recursive: true });
    mkdirSync(join(data, 'logs'), { recursive: true });
    writeFileSync(join(data, 'saves', 'shawn.auto.json'), '{"version":2,"clock":7.5}\n');
    writeFileSync(join(data, 'profiles.json'), '[{"id":"shawn"}]\n');
    writeFileSync(join(data, 'logs', 'translator-20261125.jsonl'), '{"kind":"turn"}\n');
    execFileSync('bash', [join(root, 'scripts/backup.sh'), data, join(t, 'backups'), '3']);
    const [archive] = readdirSync(join(t, 'backups'));
    expect(archive).toMatch(/^starwake-data-\d{8}-\d{6}\.tar\.gz$/);

    // Disaster: the save is overwritten.
    writeFileSync(join(data, 'saves', 'shawn.auto.json'), 'garbage');
    execFileSync('bash', [join(root, 'scripts/restore.sh'), join(t, 'backups', archive!), data]);
    expect(readFileSync(join(data, 'saves', 'shawn.auto.json'), 'utf8')).toBe('{"version":2,"clock":7.5}\n');
    expect(readFileSync(join(data, 'profiles.json'), 'utf8')).toBe('[{"id":"shawn"}]\n');
    const aside = readdirSync(t).find((f) => f.startsWith('data.before-restore-'))!;
    expect(readFileSync(join(t, aside, 'saves', 'shawn.auto.json'), 'utf8')).toBe('garbage');
  });

  it('refuses a missing or broken archive without touching the data', () => {
    const t = mkdtempSync(join(tmpdir(), 'sw-bk-'));
    dirs.push(t);
    const data = join(t, 'data');
    mkdirSync(data);
    writeFileSync(join(data, 'keep.json'), '1');
    writeFileSync(join(t, 'bad.tar.gz'), 'not a tarball');
    expect(() =>
      execFileSync('bash', [join(root, 'scripts/restore.sh'), join(t, 'bad.tar.gz'), data], {
        stdio: 'pipe',
      }),
    ).toThrow();
    expect(() =>
      execFileSync('bash', [join(root, 'scripts/restore.sh'), join(t, 'nope.tar.gz'), data], {
        stdio: 'pipe',
      }),
    ).toThrow();
    expect(readFileSync(join(data, 'keep.json'), 'utf8')).toBe('1');
  });
});
