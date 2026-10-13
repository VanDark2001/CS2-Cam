package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"math"
	"os"
	"sort"
	"strconv"
	"strings"

	demoinfocs "github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs"
	"github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs/common"
	"github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs/events"
	st "github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs/sendtables"
)

var weaponNames = map[common.EquipmentType]string{
	common.EqP2000: "hkp2000", common.EqGlock: "glock", common.EqP250: "p250",
	common.EqDeagle: "deagle", common.EqFiveSeven: "fiveseven", common.EqDualBerettas: "elite",
	common.EqTec9: "tec9", common.EqCZ: "cz75a", common.EqUSP: "usp_silencer", common.EqRevolver: "revolver",
	common.EqMP7: "mp7", common.EqMP9: "mp9", common.EqBizon: "bizon", common.EqMac10: "mac10",
	common.EqUMP: "ump45", common.EqP90: "p90", common.EqMP5: "mp5sd", common.EqSawedOff: "sawedoff",
	common.EqNova: "nova", common.EqMag7: "mag7", common.EqXM1014: "xm1014", common.EqM249: "m249", common.EqNegev: "negev",
	common.EqGalil: "galilar", common.EqFamas: "famas", common.EqAK47: "ak47", common.EqM4A4: "m4a1",
	common.EqM4A1: "m4a1s", common.EqSSG08: "ssg08", common.EqSG553: "sg556", common.EqAUG: "aug",
	common.EqAWP: "awp", common.EqScar20: "scar20", common.EqG3SG1: "g3sg1", common.EqZeus: "taser",
	common.EqBomb: "c4", common.EqKnife: "knife", common.EqDecoy: "decoy", common.EqMolotov: "molotov",
	common.EqIncendiary: "incgrenade", common.EqFlash: "flashbang", common.EqSmoke: "smokegrenade", common.EqHE: "hegrenade",
}

var knifeNames = map[int]string{
	500: "bayonet", 503: "knife_css", 505: "knife_flip", 506: "knife_gut", 507: "knife_karambit",
	508: "knife_m9_bayonet", 509: "knife_tactical", 512: "knife_falchion", 514: "knife_survival_bowie",
	515: "knife_butterfly", 516: "knife_push", 517: "knife_cord", 518: "knife_canis", 519: "knife_ursus",
	520: "knife_gypsy_jackknife", 521: "knife_outdoor", 522: "knife_stiletto", 523: "knife_widowmaker",
	525: "knife_skeleton", 526: "knife_kukri",
}

func weaponName(weapon *common.Equipment) string {
	if weapon.Type == common.EqKnife && weapon.Entity != nil {
		if value, ok := weapon.Entity.PropertyValue("m_AttributeManager.m_Item.m_iItemDefinitionIndex"); ok {
			if name := knifeNames[int(value.UInt64())]; name != "" {
				return name
			}
		}
	}
	if name := weaponNames[weapon.Type]; name != "" {
		return name
	}
	return strings.TrimPrefix(strings.TrimPrefix(strings.ToLower(weapon.Entity.ServerClass().Name()), "cweapon"), "c")
}

func optionalInt(entity st.Entity, key string) any {
	if value, ok := entity.PropertyValue(key); ok && value.Any != nil {
		switch v := value.Any.(type) {
		case int32:
			return int(v)
		case uint64:
			return int(v)
		}
	}
	return nil
}

func run() error {
	demo := flag.String("demo", "", "Demo path")
	output := flag.String("output", "", "NDJSON output path")
	start := flag.Int("start", 0, "First official demo tick")
	step := flag.Int("step", 4, "Snapshot interval in ticks")
	probeTicks := flag.String("ticks", "", "Comma-separated diagnostic ticks; empty exports all samples")
	blindsOnly := flag.Bool("blinds-only", false, "Export PlayerFlashed events reconstructed from network state")
	flag.Parse()
	if *demo == "" || *output == "" || *step < 1 {
		return fmt.Errorf("demo, output and a positive step are required")
	}
	file, err := os.Open(*demo)
	if err != nil {
		return err
	}
	defer file.Close()
	out, err := os.Create(*output)
	if err != nil {
		return err
	}
	defer out.Close()
	buffer := bufio.NewWriterSize(out, 1024*1024)
	encoder := json.NewEncoder(buffer)
	p := demoinfocs.NewParser(file)
	defer p.Close()
	counts := map[string]int{}
	wantedTicks := map[int]bool{}
	if *probeTicks != "" {
		for _, value := range strings.Split(*probeTicks, ",") {
			tick, err := strconv.Atoi(value)
			if err != nil {
				return err
			}
			wantedTicks[tick] = true
		}
	}
	lastTick := -1
	var writeErr error
	p.RegisterEventHandler(func(event events.PlayerFlashed) {
		if !*blindsOnly || writeErr != nil || event.Player == nil || event.Attacker == nil {
			return
		}
		tick := p.GameState().IngameTick()
		if tick < *start || event.Player.SteamID64 == 0 || event.Attacker.SteamID64 == 0 || event.Player.FlashDuration <= 0 {
			return
		}
		writeErr = encoder.Encode(map[string]any{
			"tick": tick, "user_steamid": strconv.FormatUint(event.Player.SteamID64, 10),
			"user_name": event.Player.Name, "attacker_steamid": strconv.FormatUint(event.Attacker.SteamID64, 10),
			"attacker_name": event.Attacker.Name, "blind_duration": event.Player.FlashDuration,
			"source": "demoinfocs-player-flashed",
		})
	})
	p.RegisterEventHandler(func(events.FrameDone) {
		if *blindsOnly {
			return
		}
		tick := p.GameState().IngameTick()
		if tick < *start || tick == lastTick || writeErr != nil {
			return
		}
		if len(wantedTicks) > 0 {
			if !wantedTicks[tick] {
				return
			}
		} else if tick%*step != 0 {
			return
		}
		lastTick = tick
		for _, player := range p.GameState().Participants().Playing() {
			pawn := player.PlayerPawnEntity()
			if player.SteamID64 == 0 || pawn == nil {
				continue
			}
			// Do not turn an absent network position into a plausible (0, 0).
			hasPosition := true
			for _, key := range []string{"m_cellX", "m_cellY", "m_cellZ", "m_vecX", "m_vecY", "m_vecZ"} {
				if value, ok := pawn.PropertyValue("CBodyComponent." + key); !ok || value.Any == nil {
					hasPosition = false
					break
				}
			}
			if !hasPosition {
				continue
			}
			position := player.Position()
			if math.IsNaN(position.X) || math.IsNaN(position.Y) || math.IsInf(position.X, 0) || math.IsInf(position.Y, 0) {
				continue
			}
			sid := strconv.FormatUint(player.SteamID64, 10)
			inventory := []string{}
			for _, weapon := range player.Weapons() {
				if weapon == nil || weapon.Entity == nil {
					continue
				}
				inventory = append(inventory, weaponName(weapon))
			}
			if player.HasDefuseKit() {
				inventory = append(inventory, "defuser")
			}
			sort.Strings(inventory)
			var activeWeapon any
			if weapon := player.ActiveWeapon(); weapon != nil && weapon.Entity != nil {
				activeWeapon = weaponName(weapon)
			}
			var yaw, alive any
			if value, ok := pawn.PropertyValue("m_angEyeAngles"); ok && value.Any != nil {
				yaw = value.R3Vec().Y
			}
			if value, ok := pawn.PropertyValue("m_lifeState"); ok && value.Any != nil {
				alive = value.UInt64() == 0
			}
			row := map[string]any{
				"tick": tick, "steamid": sid, "X": position.X, "Y": position.Y, "Z": position.Z,
				"yaw": yaw, "health": optionalInt(pawn, "m_iHealth"), "m_ArmorValue": optionalInt(pawn, "m_ArmorValue"),
				"is_alive": alive, "team_num": optionalInt(pawn, "m_iTeamNum"), "balance": optionalInt(player.Entity, "m_pInGameMoneyServices.m_iAccount"),
				"weapon": activeWeapon, "inventory": inventory,
			}
			if err := encoder.Encode(row); err != nil {
				writeErr = err
				p.Cancel()
				return
			}
			counts[sid]++
		}
	})
	if err := p.ParseToEnd(); err != nil {
		return err
	}
	if writeErr != nil {
		return writeErr
	}
	if err := buffer.Flush(); err != nil {
		return err
	}
	if err := out.Sync(); err != nil {
		return err
	}
	return json.NewEncoder(os.Stderr).Encode(map[string]any{"engine": "demoinfocs-v5.2.0", "players": counts})
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
