// R3-409 two-tab live drill app — the canonical store.ts pattern (chess) reduced
// to the drill surface: openSettings (kept handle), createSpace, mount('space:'),
// fs.promises.watch (recursive) over the space root, root + nested writes, a
// post-teardown op probe, and mounts-change recording. Everything is mirrored on
// window.__drill (plus the action functions) so a CDP drive can read and steer it.
import React, { useEffect, useRef, useState } from 'react';
import fs from 'fs';
import { openSettings, createSpace, mount as mountById, onMountsChange } from '@immediately-run/sdk/mounts';

const SPACE_NAME = 'R3-409 two-tab drill';

export default function App() {
  const [line, setLine] = useState('boot…');
  const drill = useRef({
    state: 'boot',
    events: [],
    writes: [],
    mountEvents: [],
    postOps: [],
    mountInfo: null,
    cfgPath: null,
    settingsPath: null,
    root: null,
    spaceId: null,
    watchOn: false,
    watchEnded: false,
  }).current;
  const render = useState(0)[1];
  const bump = () => render((n) => n + 1);
  const say = (m) => {
    drill.state = m;
    setLine(m);
  };
  const errText = (e) => (e && (e.code || e.message)) || String(e);

  useEffect(() => {
    const stop = onMountsChange((mounts, removed) => {
      for (const r of removed ?? []) {
        drill.mountEvents.push({ reason: r.reason ?? 'unknown', id: r.id ?? '', path: r.path ?? '', t: Date.now() });
      }
      bump();
    });
    (async () => {
      try {
        const settings = await openSettings();
        drill.settingsPath = settings.path;
        const cfgPath = settings.path + '/config.json';
        drill.cfgPath = cfgPath;
        let cfg = {};
        try {
          cfg = JSON.parse(await fs.promises.readFile(cfgPath, 'utf8'));
        } catch {
          /* no remembered space yet */
        }
        if (cfg.spaceId) {
          const m = await mountById('space:' + cfg.spaceId);
          drill.spaceId = cfg.spaceId;
          drill.root = m.path;
          drill.mountInfo = { path: m.path, mode: m.mode, type: m.type, id: m.id, name: m.name };
          say('mounted remembered ' + cfg.spaceId + ' @ ' + m.path + ' mode=' + m.mode);
        } else {
          say('no remembered space — press Create');
        }
      } catch (e) {
        say('boot error: ' + errText(e));
      }
      bump();
    })();
    return () => {
      stop && stop();
    };
  }, []);

  const create = async () => {
    const rec = { t: Date.now() };
    try {
      say('creating space…');
      const m = await createSpace({ name: SPACE_NAME });
      drill.spaceId = m.id;
      drill.root = m.path;
      drill.mountInfo = { path: m.path, mode: m.mode, type: m.type, id: m.id, name: m.name };
      await fs.promises.writeFile(drill.cfgPath, JSON.stringify({ spaceId: m.id }, null, 2));
      rec.ok = true;
      rec.mount = drill.mountInfo;
      say('created + remembered ' + m.id + ' @ ' + m.path);
    } catch (e) {
      rec.ok = false;
      rec.error = errText(e);
      say('create error: ' + errText(e));
    }
    rec.tDone = Date.now();
    bump();
    return rec;
  };

  const startWatch = async () => {
    if (drill.watchOn || !drill.root) return { ok: false, error: 'no root or already watching' };
    drill.watchOn = true;
    say('watching ' + drill.root + ' (recursive)');
    bump();
    try {
      const it = fs.promises.watch(drill.root, { recursive: true });
      drill.watchStartedAt = Date.now();
      (async () => {
        try {
          for await (const ev of it) {
            drill.events.push({ eventType: ev.eventType, filename: String(ev.filename), t: Date.now() });
            bump();
          }
          drill.watchEnded = true;
          drill.mountEvents.push({ reason: 'watch-iterator-ended', id: '', path: '', t: Date.now() });
          bump();
        } catch (e) {
          drill.mountEvents.push({ reason: 'watch-error: ' + errText(e), id: '', path: '', t: Date.now() });
          bump();
        }
      })();
      return { ok: true, root: drill.root };
    } catch (e) {
      say('watch error: ' + errText(e));
      return { ok: false, error: errText(e) };
    }
  };

  const writeRoot = async () => {
    const name = 'spike-' + Date.now() + '.json';
    const p = drill.root + '/' + name;
    const rec = { path: p, filename: name, t: Date.now() };
    try {
      await fs.promises.writeFile(p, JSON.stringify({ t: Date.now() }));
      rec.ok = true;
    } catch (e) {
      rec.ok = false;
      rec.error = errText(e);
    }
    rec.tDone = Date.now();
    drill.writes.push(rec);
    bump();
    return rec;
  };

  const writeNested = async () => {
    const dir = drill.root + '/games/g1';
    const name = 'move-' + Date.now() + '.txt';
    const p = dir + '/' + name;
    const rec = { path: p, filename: 'games/g1/' + name, t: Date.now(), nested: true };
    try {
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.writeFile(p, 'move');
      rec.ok = true;
    } catch (e) {
      rec.ok = false;
      rec.error = errText(e);
    }
    rec.tDone = Date.now();
    drill.writes.push(rec);
    bump();
    return rec;
  };

  const postOp = async () => {
    const rec = { t: Date.now() };
    try {
      await fs.promises.readFile(drill.root + '/spike-missing.json', 'utf8');
      rec.ok = true;
      rec.note = 'unexpected success';
    } catch (e) {
      rec.ok = false;
      rec.error = errText(e);
    }
    rec.tDone = Date.now();
    drill.postOps.push(rec);
    bump();
    return rec;
  };

  useEffect(() => {
    window.__drill = {
      get state() {
        return drill.state;
      },
      get events() {
        return drill.events;
      },
      get writes() {
        return drill.writes;
      },
      get mountEvents() {
        return drill.mountEvents;
      },
      get postOps() {
        return drill.postOps;
      },
      get mountInfo() {
        return drill.mountInfo;
      },
      get spaceId() {
        return drill.spaceId;
      },
      get root() {
        return drill.root;
      },
      get watchOn() {
        return drill.watchOn;
      },
      get watchEnded() {
        return drill.watchEnded;
      },
    };
    window.__drillActions = { create, startWatch, writeRoot, writeNested, postOp };
  });

  return (
    <div style={{ fontFamily: 'monospace', fontSize: 12, padding: 8 }}>
      <h2>R3-409 two-tab watch drill</h2>
      <div data-testid="state">{line}</div>
      <div data-testid="root">{drill.root ?? ''}</div>
      <div>
        <button onClick={() => void create()} disabled={!!drill.mountInfo}>
          Create drill space
        </button>
        <button onClick={() => void startWatch()} disabled={!drill.mountInfo || drill.watchOn}>
          Start recursive watch
        </button>
        <button onClick={() => void writeRoot()} disabled={!drill.mountInfo}>
          Write root file
        </button>
        <button onClick={() => void writeNested()} disabled={!drill.mountInfo}>
          Write nested file
        </button>
        <button onClick={() => void postOp()} disabled={!drill.mountInfo}>
          Post-teardown op
        </button>
      </div>
      <h3>watch events ({drill.events.length})</h3>
      <ul>
        {drill.events.slice(-12).map((e, i) => (
          <li key={i}>
            {e.t} {e.eventType} {e.filename}
          </li>
        ))}
      </ul>
      <h3>writes ({drill.writes.length})</h3>
      <ul>
        {drill.writes.slice(-12).map((w, i) => (
          <li key={i}>
            {w.tDone} {w.filename}
            {w.ok ? '' : ' ERR ' + w.error}
          </li>
        ))}
      </ul>
      <h3>mount events ({drill.mountEvents.length})</h3>
      <ul>
        {drill.mountEvents.map((m, i) => (
          <li key={i}>
            {m.t} {m.reason} {m.id}
          </li>
        ))}
      </ul>
      <h3>post-teardown ops ({drill.postOps.length})</h3>
      <ul>
        {drill.postOps.map((o, i) => (
          <li key={i}>
            {o.tDone} {o.ok ? 'ok (UNEXPECTED)' : 'refused: ' + o.error}
          </li>
        ))}
      </ul>
    </div>
  );
}
