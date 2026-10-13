const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

async function recorder(indices = [5, 6]) {
    const source = fs.readFileSync(path.join(__dirname, 'batch_capture.js'), 'utf8');
    const players = indices.map(index => ({steamid: String(90000000000000001n + BigInt(index)), capture_path: `player_${index}`}));
    const config = {players, start_tick: 1300, end_tick: 1428, demo_path: 'test.dem', monitor_url: 'ws://localhost/test'};
    let now = 0, tick = 10, paused = false, callback, render;
    const view = {index: 5, mode: 3}, commands = [], reports = [], health = {5: 100, 6: 100};
    const steam = index => String(90000000000000001n + BigInt(index));
    const controllers = index => ({isPlayerController: () => true, getSteamId: () => BigInt(steam(index)), getPlayerPawnHandle: () => 200 + index});
    const mirv = {
        message() {}, isHandleValid: value => value > 0, getHandleEntryIndex: value => value,
        getDemoTick: () => tick, isPlayingDemo: () => true,
        getEntityFromSplitScreenPlayer: () => ({getPlayerPawnHandle: () => 100}),
        getEntityFromIndex: index => {
            if (index === 100) return {getObserverMode: () => view.mode, getObserverTargetHandle: () => 200 + view.index};
            if (index === 205 || index === 206) return {getPlayerControllerHandle: () => index - 200, getHealth: () => health[index - 200]};
            return index === 5 || index === 6 ? controllers(index) : null;
        },
        connect_async: async () => ({in: {next: async () => null}, out: {send: async raw => reports.push(JSON.parse(raw))}}),
        events: {
            clientFrameStageNotify: {on: (_, fn) => { callback = fn; }},
            cViewRenderSetupView: {on: (_, fn) => { render = fn; }},
        },
        exec: text => {
            commands.push(text);
            for (const command of text.split(';').map(text => text.trim())) {
                if (/^playdemo/.test(command)) { tick = 10; paused = false; }
                if (/^demo_gototick /.test(command)) tick = Number(command.split(' ')[1]);
                if (command === 'demo_pause') paused = true;
                if (command === 'demo_resume') paused = false;
                if (/^spec_player /.test(command)) view.index = Number(command.split(' ')[1]);
                if (/^spec_mode /.test(command)) view.mode = Number(command.split(' ')[1]);
            }
        },
    };
    const context = vm.createContext({mirv, Date: {now: () => now}, Promise, JSON, String, Math});
    vm.runInContext(source.replaceAll('__CONFIG__', JSON.stringify(config)), context);
    async function frame(ms = 16) {
        now += ms; if (!paused) tick++;
        render({gameView: {x: view.index * 100, y: 200, z: 64, rX: 0, rY: 90, rZ: 0, fov: 90}});
        callback({isBefore: false, curStage: 12});
        await Promise.resolve(); await Promise.resolve();
    }
    await Promise.resolve(); await Promise.resolve();
    return {commands, reports, view, health, frame, render, get tick() { return tick; }};
}

async function until(capture, predicate) {
    for (let i = 0; i < 2500; i++) { if (predicate()) return; await capture.frame(); }
    assert.fail('state did not settle');
}

test('each player locks mode 2 and their own exact SteamID at the requested start', async () => {
    const capture = await recorder();
    await until(capture, () => capture.reports.some(event => event.type === 'done'));
    const starts = capture.reports.filter(event => event.type === 'started');
    assert.equal(starts.length, 2);
    assert.deepEqual(starts.map(event => event.target), [5, 6]);
    for (const event of starts) {
        assert.equal(event.mode, 2);
        assert.equal(event.observedSteamid, event.steamid);
        assert.equal(event.tick, 1300);
    }
    assert.ok(!capture.commands.some(command => command.includes('mirv_script_spec_lock') || /spec_mode;/.test(command)));
    assert.ok(capture.commands.some(command => command.includes('demo_timescale 1; mirv_streams record')));
});

test('third-person of the correct living player aborts instead of being published', async () => {
    const capture = await recorder([5]);
    await until(capture, () => capture.reports.some(event => event.type === 'started'));
    capture.view.mode = 3;
    await capture.frame();
    assert.ok(capture.reports.some(event => event.type === 'error'));
    assert.ok(!capture.reports.some(event => event.type === 'finished'));
});

test('another player in first person aborts immediately', async () => {
    const capture = await recorder([5]);
    await until(capture, () => capture.reports.some(event => event.type === 'started'));
    capture.view.index = 6;
    await capture.frame();
    assert.ok(capture.reports.some(event => event.type === 'error'));
});

test('death pins own camera and records until the same end tick, never another POV', async () => {
    const capture = await recorder([5]);
    await until(capture, () => capture.reports.some(event => event.type === 'started'));
    capture.health[5] = 0; capture.view.index = 6;
    await capture.frame();
    assert.ok(!capture.reports.some(event => event.type === 'finished'));
    const death = capture.reports.find(event => event.type === 'death_camera');
    assert.equal(death.view.x, 500);
    assert.equal(capture.render({gameView: {x: 6000}}).x, 500);
    await until(capture, () => capture.reports.some(event => event.type === 'done'));
    const end = capture.reports.find(event => event.type === 'finished');
    assert.equal(end.reason, 'round_end');
    assert.equal(end.tick, 1428);
    assert.ok(!capture.reports.some(event => event.type === 'error'));
});

test('a dead first player cannot leave a death override on the next player', async () => {
    const capture = await recorder();
    await until(capture, () => capture.reports.some(event => event.type === 'started'));
    capture.health[5] = 0;
    await until(capture, () => capture.reports.some(event => event.type === 'started' && event.player === 1));
    assert.equal(capture.render({gameView: {x: 600, y: 200, z: 64, rX: 0, rY: 90, rZ: 0, fov: 90}}), undefined);
    await until(capture, () => capture.reports.some(event => event.type === 'done'));
    assert.deepEqual(capture.reports.filter(event => event.type === 'finished').map(event => event.tick), [1428, 1428]);
});
