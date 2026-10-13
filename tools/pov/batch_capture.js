"use strict";
// __CONFIG__ is replaced with task JSON by the launcher.
{
    const config = __CONFIG__;
const demoTimescale = Number(config.demo_timescale) > 0 ? Number(config.demo_timescale) : 1;
    const id = 'csdemo-batch-capture';
    // CS2 uses mode 2 for in-eye, not the Source 1 mode 4.
    const IN_EYE = 2, ROAMING = 4, RENDER_PASS = 12;
    let player = 0, state = 'connecting', target = null, stableSince = null;
    let deadline = Date.now() + 90000, until = 0, frames = 0;
    let lastCommand = -Infinity, lastDiagnostic = -Infinity, jumped = false;
    let connection = null, sending = Promise.resolve();
    let lastOwnView = null, deathView = null, deathSince = null;

    function report(type, extra = {}) {
        const event = {type, player, tick: mirv.getDemoTick(), ...extra};
        mirv.message(`CSDEMO_${type.toUpperCase()} ${JSON.stringify(event)}\n`);
        if (connection) {
            sending = sending.then(() => connection.out.send(JSON.stringify(event)))
                .catch(() => { state = 'failed'; mirv.exec('mirv_streams record end; quit'); });
        }
    }
    function fail(reason) {
        report('error', {reason});
        mirv.exec('mirv_streams record end; demo_pause');
        state = 'failed'; until = Date.now() + 2500;
    }
    function entity(handle) {
        return mirv.isHandleValid(handle)
            ? mirv.getEntityFromIndex(mirv.getHandleEntryIndex(handle)) : null;
    }
    function observer() {
        const local = mirv.getEntityFromSplitScreenPlayer(0);
        const pawn = local && entity(local.getPlayerPawnHandle());
        const observed = pawn && entity(pawn.getObserverTargetHandle());
        const controller = observed && entity(observed.getPlayerControllerHandle());
        return {
            mode: pawn ? pawn.getObserverMode() : -1,
            observedIndex: controller ? mirv.getHandleEntryIndex(observed.getPlayerControllerHandle()) : -1,
            observedSteamid: controller ? String(controller.getSteamId()) : '',
        };
    }
    function findTarget() {
        const wanted = String(config.players[player].steamid);
        for (let i = 1; i <= 64; i++) {
            const candidate = mirv.getEntityFromIndex(i);
            if (candidate && candidate.isPlayerController() && String(candidate.getSteamId()) === wanted) {
                return i;
            }
        }
        return null;
    }
    function targetPawn() {
        const controller = target !== null && mirv.getEntityFromIndex(target);
        if (!controller || String(controller.getSteamId()) !== String(config.players[player].steamid)) return null;
        return entity(controller.getPlayerPawnHandle());
    }
    function correct(view) {
        return view.mode === IN_EYE && view.observedIndex === target
            && view.observedSteamid === String(config.players[player].steamid);
    }
    function lock() {
        if (target === null || Date.now() - lastCommand < 250) return;
        // Numeric entity indices avoid nickname matching and Unicode ambiguity.
        mirv.exec(`spec_autodirector 0; spec_player ${target}; spec_mode ${IN_EYE}`);
        lastCommand = Date.now();
    }
    function seek() {
        target = null; stableSince = null; frames = 0; jumped = false;
        lastOwnView = null; deathView = null; deathSince = null;
        lastCommand = -Infinity; lastDiagnostic = -Infinity;
        state = 'loading'; deadline = Date.now() + 90000;
        mirv.exec(`spec_autodirector 0; playdemo "${config.demo_path}"`);
    }
    function finish(reason) {
        mirv.exec('mirv_streams record end; demo_pause');
        report('finished', {steamid: String(config.players[player].steamid), reason});
        state = 'flushing'; until = Date.now() + 10000; deadline = until + 30000;
    }
    function holdDeathView() {
        if (deathView) return;
        if (!lastOwnView) { fail('No verified own camera available at death'); return; }
        deathView = {...lastOwnView}; deathSince = Date.now();
        // Free observer mode removes another player's weapon/HUD. The view
        // override below pins the camera, so it cannot roam or follow a teammate.
        mirv.exec(`spec_autodirector 0; spec_mode ${ROAMING}`);
        lastCommand = Date.now();
        report('death_camera', {steamid: String(config.players[player].steamid), view: deathView});
    }
    mirv.events.cViewRenderSetupView.on(id, e => {
        if (state !== 'recording' && state !== 'arming') return;
        const pawn = targetPawn(), view = observer();
        // Detect death before rendering, not only after FRAME_RENDER_PASS: CS2
        // can change its native observer target on the very first death frame.
        if (state === 'recording' && pawn && pawn.getHealth() <= 0) holdDeathView();
        if (deathView) return {...deathView};
        if (pawn && pawn.getHealth() > 0 && correct(view)) {
            const own = e.gameView;
            if (['x', 'y', 'z', 'rX', 'rY', 'rZ', 'fov'].every(key => Number.isFinite(own[key]))) {
                lastOwnView = {...own};
            }
        }
    });
    mirv.events.clientFrameStageNotify.on(id, e => {
        if (e.isBefore || e.curStage !== RENDER_PASS || state === 'done' || state === 'connecting') return;
        if (state === 'failed') {
            if (Date.now() >= until) { state = 'done'; mirv.exec('quit'); }
            return;
        }
        if (Date.now() > deadline) { fail(`Timeout in ${state}`); return; }
        if (state === 'flushing') {
            if (Date.now() < until) return;
            player++;
            if (player < config.players.length) seek();
            else {
                report('done'); state = 'done';
                sending.then(() => mirv.exec('quit'));
            }
            return;
        }
        const tick = mirv.getDemoTick();
        if (!mirv.isPlayingDemo() || tick === undefined) return;
        if (state === 'loading') {
            if (++frames >= 120 && tick > 0) {
                // Settle renderer/observer before the requested interval, then
                // rewind to the exact start rather than omitting several seconds.
                mirv.exec(`demo_gototick ${Math.max(1, config.start_tick - 512)}; demo_timescale ${demoTimescale}; demo_resume`);
                state = 'locking';
            }
            return;
        }
        if (state === 'locking' || state === 'arming') {
            if (target === null) target = findTarget();
            if (target === null) return;
            const view = observer();
            if (Date.now() - lastDiagnostic >= 1000) {
                report('observer', {state, target, ...view}); lastDiagnostic = Date.now();
            }
            const pawn = targetPawn();
            if (!pawn || pawn.getHealth() <= 0) { stableSince = null; lock(); return; }
            if (!correct(view)) { stableSince = null; lock(); return; }
            if (stableSince === null) stableSince = Date.now();
            if (Date.now() - stableSince < (state === 'locking' ? 1000 : 350)) return;
            if (state === 'locking') {
                mirv.exec(`demo_pause; demo_gototick ${config.start_tick}`);
                state = 'arming'; stableSince = null; jumped = false;
                return;
            }
            if (Math.abs(tick - config.start_tick) > 1) {
                if (!jumped) {
                    mirv.exec(`demo_pause; demo_gototick ${config.start_tick}`);
                    jumped = true; stableSince = null;
                }
                return;
            }
            // Re-assert normal demo speed at the exact recording boundary.
            // The isolated profile normally starts at 1x, but an explicit
            // command here prevents a stale HLAE/CS2 demo_timescale from
            // making the visible capture run faster than the authored clip.
            mirv.exec(`demo_timescale ${demoTimescale}; mirv_streams record name "${config.players[player].capture_path}"; mirv_streams record start; demo_resume`);
            report('started', {steamid: String(config.players[player].steamid), target, ...view});
            state = 'recording';
            deadline = Date.now() + Math.max(120000, (config.end_tick - config.start_tick) / 64 * 4000);
            return;
        }
        if (state === 'recording') {
            const pawn = targetPawn();
            if (pawn && pawn.getHealth() <= 0) holdDeathView();
            if (state !== 'recording') return;
            const view = observer();
            if (deathView) {
                if (view.mode !== ROAMING && Date.now() - lastCommand >= 250) {
                    mirv.exec(`spec_autodirector 0; spec_mode ${ROAMING}`);
                    lastCommand = Date.now();
                }
                if (view.mode !== ROAMING && Date.now() - deathSince > 2000) {
                    fail('Could not disable player-follow camera after death'); return;
                }
            } else if (!pawn || !correct(view)) {
                fail(`POV changed for ${config.players[player].steamid}: ${JSON.stringify(view)}`);
                return;
            }
            if (tick >= config.end_tick) finish('round_end');
        }
    });
    mirv.connect_async(config.monitor_url).then(ws => {
        connection = ws;
        // Consume incoming control frames as required by HLAE's split socket.
        (async () => { while (await ws.in.next() !== null) {} })().catch(() => {});
        report('loaded'); seek();
    }).catch(error => { mirv.message(`CSDEMO_ERROR monitor: ${error}\n`); mirv.exec('quit'); });
}


