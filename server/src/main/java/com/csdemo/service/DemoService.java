package com.csdemo.service;

import com.csdemo.repository.DatabaseRepository;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import org.springframework.http.HttpStatus;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.stereotype.Service;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.nio.file.attribute.FileTime;
import java.security.MessageDigest;
import java.sql.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/**
 * Demo 业务服务，负责比赛缓存、统计计算、头像读取和解析任务调度。
 *
 * <p>统计结果必须以 SQLite {@code csdemo} 为准；队伍身份始终来自
 * {@code match_players.team_number}，不能根据 T/CT 阵营或页面顺序推断。</p>
 */
@Service
public class DemoService {
  private final DatabaseRepository databaseRepository;

  // 进程内去重只防止同一 Demo 被并发解析；数据库指纹负责跨进程、跨重启去重。
  private final Set<String> activeDemoHashes=ConcurrentHashMap.newKeySet();
  private volatile boolean demoHashesPrepared=false;

  // 比赛列表有磁盘快照和内存缓存，单场分析只保存在当前进程内。
  private volatile List<Map<String,Object>> matchesCache;
  private final Map<Long,Map<String,Object>> analyticsCache=new ConcurrentHashMap<>();
  // Replay snapshots are bucketed by tick to avoid repeating correlated position/KDA queries while dragging.
  private final Map<String,Map<String,Object>> replayCache=new ConcurrentHashMap<>();
  private final AtomicBoolean matchesRefreshRunning=new AtomicBoolean(false);
  private final ObjectMapper objectMapper=new ObjectMapper();
  private final Map<String,Map<String,Object>> povJobs=new ConcurrentHashMap<>();
  private final Path matchesSnapshot=Path.of(System.getProperty("user.dir")).toAbsolutePath().resolve(".cache").resolve("matches.json");

  public DemoService(DatabaseRepository databaseRepository) {
    this.databaseRepository=databaseRepository;
  }

  /** 启动时先加载快照以快速响应，再异步用 SQLite 中的真实数据刷新。 */
  @PostConstruct public void initializeMatchesCache(){
    try{Class.forName("org.sqlite.JDBC");}catch(ClassNotFoundException e){throw new IllegalStateException("SQLite JDBC 驱动未安装",e);}
    if(Files.isRegularFile(matchesSnapshot))try{Map<String,Object> snapshot=objectMapper.readValue(matchesSnapshot.toFile(),new TypeReference<Map<String,Object>>(){});if(!databaseRepository.databaseFile().equals(snapshot.get("database")))throw new IOException("database changed");matchesCache=List.copyOf(objectMapper.convertValue(snapshot.get("matches"),new TypeReference<List<Map<String,Object>>>(){}));System.out.println("[csdemo] loaded "+matchesCache.size()+" matches from server cache");}catch(Exception e){System.err.println("[csdemo] matches cache ignored: "+e.getMessage());}
    refreshMatchesAsync();
    // Older portable data may predate avatar refresh on package import.
    // Populate only missing cache entries during startup so those records are
    // repaired without repeatedly downloading avatars that already exist.
    refreshAvatarsAsync();
  }

  /** 首次无缓存时同步加载；双重检查避免多个请求重复执行整库查询。 */
  public List<Map<String,Object>> matches() throws SQLException {
    List<Map<String,Object>> cached=matchesCache;if(cached!=null)return cached;
    synchronized(this){cached=matchesCache;if(cached!=null)return cached;matchesCache=loadMatchesFromDatabase();writeMatchesSnapshot(matchesCache);return matchesCache;}
  }
  /**
   * 加载最近比赛，并按“Demo 文件名 + 最后事件 tick”过滤历史重复记录。
   * 去重后的比赛 ID 也是所有跨比赛统计的统一数据集。
   */
  private List<Map<String,Object>> loadMatchesFromDatabase()throws SQLException{
    List<Map<String,Object>> out=new ArrayList<>();Set<String> seenMatches=new HashSet<>();
    try(Connection c=databaseRepository.connection(); PreparedStatement ps=c.prepareStatement("SELECT id,map_name,server_name,COALESCE(recorded_at,imported_at) display_time,recording_time_source,demo_file_path,final_score_t,final_score_ct,official_start_tick,warmup_end_tick,(SELECT COALESCE(MAX(e.tick),0) FROM events e WHERE e.match_id=matches.id) event_end_tick FROM matches ORDER BY recorded_at IS NULL,COALESCE(recorded_at,imported_at) DESC,id DESC LIMIT 200")){
      ResultSet rs=ps.executeQuery();
      while(rs.next()){
        long id=rs.getLong("id");String storedPath=rs.getString("demo_file_path"),fileName;try{fileName=Path.of(storedPath).getFileName().toString();}catch(Exception ignored){fileName=storedPath;}String fingerprint=fileName+"|"+rs.getLong("event_end_tick");if(!seenMatches.add(fingerprint))continue;Map<String,Object> m=new LinkedHashMap<>();
        m.put("id",id);m.put("map",rs.getString("map_name"));m.put("result","已解析");m.put("score",rs.getObject("final_score_ct")==null?"—":rs.getInt("final_score_ct")+" : "+rs.getInt("final_score_t"));m.put("date",rs.getString("display_time"));m.put("dateSource",rs.getString("recording_time_source"));m.put("server",rs.getString("server_name"));m.put("file",rs.getString("demo_file_path"));m.put("status","已完成");m.put("tickRate",64);
        m.put("teamNames",databaseRepository.teamNames(c,id));
        try{m.put("players",loadPlayers(c,id,nullableLong(rs,"official_start_tick"),nullableLong(rs,"warmup_end_tick")));}
        catch(Exception e){System.err.println("[csdemo] match "+id+" stats degraded: "+e.getMessage());m.put("players",loadRoster(c,id));m.put("statsWarning",e.getMessage());}
        out.add(m);
      }
    }
    return List.copyOf(out);
  }
  /** 后台刷新期间保留旧缓存，避免上传完成后的数据库查询阻塞页面。 */
  private void refreshMatchesAsync(){
    if(!matchesRefreshRunning.compareAndSet(false,true))return;
    CompletableFuture.runAsync(()->{try{List<Map<String,Object>> fresh=loadMatchesFromDatabase();matchesCache=fresh;writeMatchesSnapshot(fresh);System.out.println("[csdemo] refreshed "+fresh.size()+" matches in server cache");}catch(Exception e){System.err.println("[csdemo] matches cache refresh failed: "+e.getMessage());}finally{matchesRefreshRunning.set(false);}});
  }
  /** 先写临时文件再原子替换，防止进程中断留下半份 JSON。 */
  private void writeMatchesSnapshot(List<Map<String,Object>> data){
    try{Files.createDirectories(matchesSnapshot.getParent());Path temporary=matchesSnapshot.resolveSibling("matches.json.tmp");objectMapper.writeValue(temporary.toFile(),Map.of("database",databaseRepository.databaseFile(),"matches",data));try{Files.move(temporary,matchesSnapshot,StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);}catch(AtomicMoveNotSupportedException ignored){Files.move(temporary,matchesSnapshot,StandardCopyOption.REPLACE_EXISTING);}}
    catch(Exception e){System.err.println("[csdemo] matches cache write failed: "+e.getMessage());}
  }
  public Map<String,Object> detail(long id)throws SQLException{return matches().stream().filter(m->((Number)m.get("id")).longValue()==id).findFirst().orElseThrow();}
  public synchronized void invalidateAfterPackageImport() {
    matchesCache=null;analyticsCache.clear();replayCache.clear();
    try { Files.deleteIfExists(matchesSnapshot); } catch(IOException ignored) { }
    refreshAvatarsAsync();
  }

  /**
   * A match package contains roster rows and media, but avatar files are local
   * cache data. Re-run the existing Steam scraper after import so newly
   * imported players receive the same treatment as freshly parsed Demos.
   */
  private void refreshAvatarsAsync() {
    CompletableFuture.runAsync(() -> {
      try {
        List<String> steamids = new ArrayList<>();
        try (Connection c = databaseRepository.connection();
             PreparedStatement ps = c.prepareStatement("SELECT DISTINCT steamid FROM match_players WHERE steamid GLOB '[0-9]*'")) {
          try (ResultSet rs = ps.executeQuery()) { while (rs.next()) steamids.add(rs.getString(1)); }
        }
        Path avatarRoot = avatarRoot();
        steamids = steamids.stream().filter(id -> !Files.isRegularFile(avatarRoot.resolve(id + ".jpg"))).toList();
        if (steamids.isEmpty()) return;
        Path project = Path.of(System.getenv().getOrDefault("CS2_PROJECT_ROOT",
            Path.of(System.getProperty("user.dir")).toAbsolutePath().getParent().toString()));
        Path script = project.resolve("steam_avatar_scraper.py");
        Path python = Path.of(System.getenv().getOrDefault("CS2_PYTHON", "python"));
        if (!Files.isRegularFile(script)) return;
        List<String> command = new ArrayList<>(); command.add(python.toString()); command.add(script.toString()); command.addAll(steamids);
        ProcessBuilder process = new ProcessBuilder(command).redirectErrorStream(true).redirectOutput(ProcessBuilder.Redirect.DISCARD);
        String dataRoot = System.getenv("CS2_DATA_ROOT");
        if (dataRoot != null && !dataRoot.isBlank()) process.environment().put("CS2_DATA_ROOT", dataRoot);
        process.start().waitFor(2, TimeUnit.MINUTES);
      } catch (Exception e) { System.err.println("[csdemo] avatar refresh skipped: " + e.getMessage()); }
    });
  }

  private Path avatarRoot() {
    String dataRoot = System.getenv("CS2_DATA_ROOT");
    if (dataRoot != null && !dataRoot.isBlank()) return Path.of(dataRoot).resolve("avatars");
    Path project = Path.of(System.getProperty("user.dir")).toAbsolutePath().getParent();
    return (project == null ? Path.of("avatars") : project.resolve("avatars"));
  }
  public void deleteMatch(long id) throws SQLException {
    // Deleting a demo can involve millions of position rows. Do not hold the
    // HTTP request open while SQLite removes the data and commits the transaction.
    if (!matchesCache.stream().anyMatch(m -> ((Number)m.get("id")).longValue() == id)) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "比赛不存在");
    }
    matchesCache=matchesCache.stream().filter(m->((Number)m.get("id")).longValue()!=id).toList();
    writeMatchesSnapshot(matchesCache);
    analyticsCache.remove(id);
    CompletableFuture.runAsync(() -> {
      try { deleteMatchData(id); }
      catch (Exception e) { System.err.println("[csdemo] async match deletion failed: "+e.getMessage()); }
    });
  }
  private void deleteMatchData(long id) throws SQLException {
    String demo=null;
    try(Connection c=databaseRepository.bulkConnection()){
      c.setAutoCommit(false);
      try(PreparedStatement ps=c.prepareStatement("SELECT demo_file_path FROM matches WHERE id=?")){ps.setLong(1,id);try(ResultSet rs=ps.executeQuery()){if(rs.next())demo=rs.getString(1);}}
      for(String t:new String[]{"damages","kills","events","player_positions","match_players","rounds"})try(PreparedStatement ps=c.prepareStatement("DELETE FROM "+t+" WHERE match_id=?")){ps.setLong(1,id);ps.executeUpdate();}
      try(PreparedStatement ps=c.prepareStatement("DELETE FROM matches WHERE id=?")){ps.setLong(1,id);ps.executeUpdate();}
      c.commit();
    }
    final String demoPath=demo;
    CompletableFuture.runAsync(()->{
      try{
        if(demoPath!=null)Files.deleteIfExists(Path.of(demoPath));
        Path pov=Path.of(System.getProperty("user.dir"),"pov-output",String.valueOf(id));
        if(Files.isDirectory(pov))try(var files=Files.walk(pov)){for(Path p:files.sorted(Comparator.reverseOrder()).toList())Files.deleteIfExists(p);}
      }catch(IOException e){System.err.println("[csdemo] deleted match "+id+" but file cleanup failed: "+e.getMessage());}
    });
  }
  public Map<String,Object> analytics(long id)throws SQLException{Map<String,Object> cached=analyticsCache.get(id);if(cached!=null)return cached;try(Connection c=databaseRepository.connection()){Map<String,Object> loaded=loadAnalytics(c,id);analyticsCache.put(id,loaded);return loaded;}}
  public List<Map<String,Object>> playerWeapons(String steamid)throws SQLException{
    if(!steamid.matches("\\d{17}"))throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"SteamID 格式不正确");
    List<Long> matchIds=playerMatchIds(steamid);
    if(matchIds.isEmpty())return List.of();
    String normalized=normalizedWeaponSql("k");
    List<Map<String,Object>> out=new ArrayList<>();
    String placeholders=String.join(",",Collections.nCopies(matchIds.size(),"?"));
    try(Connection c=databaseRepository.connection();PreparedStatement ps=c.prepareStatement("SELECT "+normalized+" weapon,COUNT(*) kills,COALESCE(SUM(k.headshot),0) headshots,COUNT(DISTINCT k.match_id) matches FROM kills k JOIN matches m ON m.id=k.match_id JOIN match_players a ON a.match_id=k.match_id AND a.steamid=k.attacker_steamid JOIN match_players v ON v.match_id=k.match_id AND v.steamid=k.victim_steamid WHERE k.attacker_steamid=? AND k.match_id IN ("+placeholders+") AND k.attacker_steamid<>k.victim_steamid AND a.team_number<>v.team_number AND k.tick>=COALESCE(m.official_start_tick,m.warmup_end_tick,0) "+validRound("k")+" GROUP BY weapon ORDER BY kills DESC LIMIT 8")){
      ps.setString(1,steamid);for(int i=0;i<matchIds.size();i++)ps.setLong(i+2,matchIds.get(i));ResultSet rs=ps.executeQuery();while(rs.next())out.add(Map.of("weapon",Optional.ofNullable(rs.getString(1)).orElse("unknown"),"kills",rs.getInt(2),"headshots",rs.getInt(3),"matches",rs.getInt(4)));
    }
    return out;
  }
  /** 跨去重比赛汇总玩家的阵营回合和残局尝试；队伍身份始终来自 match_players。 */
  public Map<String,Object> playerStats(String steamid)throws SQLException{
    if(!steamid.matches("\\d{17}"))throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"SteamID 格式不正确");
    List<Long> matchIds=playerMatchIds(steamid);int ctRounds=0,ctWins=0,tRounds=0,tWins=0,clutchAttempts=0,clutchWins=0;Map<Integer,int[]> clutchByX=new TreeMap<>();
    try(Connection c=databaseRepository.connection()){
      for(long matchId:matchIds){
        Map<Integer,LinkedHashSet<String>> rosters=new LinkedHashMap<>();int playerTeam=0;
        try(PreparedStatement ps=c.prepareStatement("SELECT steamid,team_number FROM match_players WHERE match_id=?")){ps.setLong(1,matchId);ResultSet rs=ps.executeQuery();while(rs.next()){String sid=rs.getString(1);int team=rs.getInt(2);rosters.computeIfAbsent(team,key->new LinkedHashSet<>()).add(sid);if(steamid.equals(sid))playerTeam=team;}}
        if(playerTeam==0)continue;
        long matchStart=scalarLong(c,"SELECT COALESCE(official_start_tick,warmup_end_tick,0) FROM matches WHERE id=?",matchId);
        List<Map.Entry<Long,String>> roundEnds=new ArrayList<>();
        try(PreparedStatement ps=c.prepareStatement("SELECT tick,JSON_EXTRACT(data_json,'$.winner') winner FROM events WHERE match_id=? AND event_name='round_end' AND JSON_EXTRACT(data_json,'$.winner') IN ('T','CT') AND tick>=? GROUP BY tick,winner ORDER BY tick")){ps.setLong(1,matchId);ps.setLong(2,matchStart);ResultSet rs=ps.executeQuery();while(rs.next())roundEnds.add(Map.entry(rs.getLong(1),rs.getString(2)));}
        if(roundEnds.isEmpty())continue;
        List<Object[]> deaths=new ArrayList<>();
        try(PreparedStatement ps=c.prepareStatement("SELECT tick,victim_steamid FROM kills WHERE match_id=? AND tick BETWEEN ? AND ? ORDER BY tick,id")){ps.setLong(1,matchId);ps.setLong(2,matchStart);ps.setLong(3,roundEnds.get(roundEnds.size()-1).getKey());ResultSet rs=ps.executeQuery();while(rs.next())deaths.add(new Object[]{rs.getLong(1),rs.getString(2)});}
        int deathIndex=0;
        for(int roundIndex=0;roundIndex<roundEnds.size();roundIndex++){
          long roundStart=roundIndex==0?matchStart:roundEnds.get(roundIndex-1).getKey()+1,roundEnd=roundEnds.get(roundIndex).getKey();int roundNumber=roundIndex+1;boolean differsFromFinal=sidesDifferFromFinal(roundNumber,roundEnds.size());int playerSide=differsFromFinal?oppositeSide(playerTeam):playerTeam,winnerSide="T".equalsIgnoreCase(roundEnds.get(roundIndex).getValue())?2:3;
          boolean roundWon=playerSide==winnerSide;if(playerSide==3){ctRounds++;if(roundWon)ctWins++;}else if(playerSide==2){tRounds++;if(roundWon)tWins++;}
          Map<Integer,LinkedHashSet<String>> alive=new LinkedHashMap<>();for(var roster:rosters.entrySet())alive.put(roster.getKey(),new LinkedHashSet<>(roster.getValue()));Integer clutchX=null;
          while(deathIndex<deaths.size()&&((Number)deaths.get(deathIndex)[0]).longValue()<roundStart)deathIndex++;
          int scanIndex=deathIndex;
          while(scanIndex<deaths.size()&&((Number)deaths.get(scanIndex)[0]).longValue()<=roundEnd){String victim=String.valueOf(deaths.get(scanIndex)[1]);for(var team:alive.values())team.remove(victim);LinkedHashSet<String> own=alive.get(playerTeam);if(clutchX==null&&own!=null&&own.size()==1&&own.contains(steamid)){int opponents=0;for(var entry:alive.entrySet())if(entry.getKey()!=playerTeam)opponents+=entry.getValue().size();if(opponents>0)clutchX=opponents;}scanIndex++;}
          deathIndex=scanIndex;
          if(clutchX!=null){clutchAttempts++;int[] bucket=clutchByX.computeIfAbsent(clutchX,key->new int[2]);bucket[0]++;LinkedHashSet<String> own=alive.get(playerTeam);if(roundWon&&own!=null&&own.contains(steamid)){clutchWins++;bucket[1]++;}}
        }
      }
    }
    List<Map<String,Object>> breakdown=new ArrayList<>();for(var entry:clutchByX.entrySet()){int[] values=entry.getValue();breakdown.add(Map.of("x",entry.getKey(),"attempts",values[0],"wins",values[1],"winRate",percentage(values[1],values[0])));}
    Map<String,Object> sides=new LinkedHashMap<>();sides.put("ct",sideStats(ctRounds,ctWins));sides.put("t",sideStats(tRounds,tWins));Map<String,Object> clutches=new LinkedHashMap<>();clutches.put("attempts",clutchAttempts);clutches.put("wins",clutchWins);clutches.put("losses",clutchAttempts-clutchWins);clutches.put("winRate",percentage(clutchWins,clutchAttempts));clutches.put("breakdown",breakdown);
    int rounds=ctRounds+tRounds,wins=ctWins+tWins;Map<String,Object> out=new LinkedHashMap<>();out.put("matches",matchIds.size());out.put("rounds",rounds);out.put("roundWins",wins);out.put("roundWinRate",percentage(wins,rounds));out.put("sides",sides);out.put("clutches",clutches);return out;
  }
  private List<Long> playerMatchIds(String steamid)throws SQLException{return matches().stream().filter(match->((List<?>)match.getOrDefault("players",List.of())).stream().anyMatch(player->player instanceof Map<?,?> row&&steamid.equals(String.valueOf(row.get("steamid"))))).map(match->((Number)match.get("id")).longValue()).toList();}
  private int oppositeSide(int side){return side==2?3:side==3?2:side;}
  private double percentage(int wins,int total){return total==0?0:Math.round(wins*1000.0/total)/10.0;}
  private Map<String,Object> sideStats(int rounds,int wins){Map<String,Object> out=new LinkedHashMap<>();out.put("rounds",rounds);out.put("wins",wins);out.put("losses",rounds-wins);out.put("winRate",percentage(wins,rounds));return out;}
  public byte[] avatar(String steamid)throws IOException{
    if(!steamid.matches("\\d{17}"))throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
    Path root=Path.of(System.getProperty("user.dir")).toAbsolutePath().getParent(),avatar=root==null?null:root.resolve("avatars").resolve(steamid+".jpg");
    if(avatar==null||!Files.isRegularFile(avatar))throw new ResponseStatusException(HttpStatus.NOT_FOUND);
    return Files.readAllBytes(avatar);
  }
  public Map<String,Object> health(){try(Connection ignored=databaseRepository.connection()){return Map.of("database","csdemo","engine","sqlite","file",databaseRepository.databaseFile(),"status","ok");}catch(SQLException e){return Map.of("database","csdemo","status","unavailable","message",e.getMessage());}}
  /** 清空统计数据但保留 SQLite 表结构和应用配置。录制/解析进行中时拒绝操作，避免新任务把数据写回清空后的数据库。 */
  public synchronized Map<String,Object> clearDatabase() throws SQLException, IOException {
    if(!activeDemoHashes.isEmpty() || povJobs.values().stream().anyMatch(job -> Set.of("queued","recording").contains(String.valueOf(job.get("status")))))
      throw new IllegalStateException("仍有解析或 POV 录制任务正在运行，请完成后再清空数据库");
    int matchCount = databaseRepository.clearStatistics();
    matchesCache=List.of();
    analyticsCache.clear();
    replayCache.clear();
    writeMatchesSnapshot(matchesCache);
    return Map.of("status","ok","matchesCleared",matchCount);
  }
  public Map<String,Object> desktopActivity(){return Map.of("parsing",activeDemoHashes.size(),"recording",povJobs.values().stream().filter(job->Set.of("queued","recording").contains(String.valueOf(job.get("status")))).count());}
  private void applyRecordingSettings(ProcessBuilder process)throws IOException {
    String dataRoot=System.getenv("CS2_DATA_ROOT");if(dataRoot==null)return;
    process.environment().put("CS2_POV_CUSTOM_CFG",Path.of(dataRoot,"recording.cfg").toString());
    Path settings=Path.of(dataRoot,"settings.json");if(!Files.isRegularFile(settings))return;
    Map<?,?> values=objectMapper.readValue(settings.toFile(),Map.class);
    for(String key:List.of("CS2_EXE","HLAE_EXE","FFMPEG_EXE","FFPROBE_EXE")){
      Object value=values.get(key);if(value instanceof String text&&!text.isBlank())process.environment().put(key,Path.of(dataRoot).resolve(text).normalize().toString());
    }
    Object recording=values.get("recording");
    if(recording instanceof Map<?,?> options){
      Object resolution=options.get("resolution");if(resolution instanceof String text&&!text.isBlank())process.environment().put("CS2_POV_RESOLUTION",text);
      Object speed=options.get("speed");if(speed instanceof String text&&!text.isBlank())process.environment().put("CS2_POV_TIMESCALE",text);
      Object bitrate=options.get("bitrate");process.environment().put("CS2_POV_BITRATE",bitrate instanceof String text&&Set.of("auto","8","12","20","30","50").contains(text)?text:"auto");
      for(var entry:Map.of("hideHud","CS2_POV_HIDE_HUD","showXray","CS2_POV_SHOW_XRAY").entrySet()){
        Object value=options.get(entry.getKey());process.environment().put(entry.getValue(),Boolean.TRUE.equals(value)||"true".equalsIgnoreCase(String.valueOf(value))?"1":"0");
      }
    }
  }
  /**
   * 暂存上传文件、计算 SHA-256、调用 Python 解析器，并在所有退出路径清理 Demo。
   * 死锁和锁等待属于可恢复错误，最多重试三次；单次解析最长等待十五分钟。
   */
  public synchronized Map<String,Object> upload(MultipartFile file,Long recordedAt)throws IOException,InterruptedException,SQLException{
    String originalName=file.getOriginalFilename()==null?"":Path.of(file.getOriginalFilename()).getFileName().toString();
    String lowerName=originalName.toLowerCase(Locale.ROOT);
    if(file.isEmpty()||file.getSize()>512L*1024*1024||(!lowerName.endsWith(".dem")&&!lowerName.endsWith(".zip")))throw new IllegalArgumentException("请上传 512MB 以内的 .dem 文件或仅含一个 Demo 的 .zip 压缩包");
    Path parserRoot=Path.of(System.getProperty("user.dir")).toAbsolutePath().getParent();
    if(parserRoot==null)throw new IllegalStateException("无法定位解析器目录");
    Path codeRoot=Path.of(System.getenv().getOrDefault("CS2_PROJECT_ROOT",parserRoot.toString()));
    Path python=Path.of(System.getenv().getOrDefault("CS2_PYTHON",parserRoot.resolve(".venv312/Scripts/python.exe").toString()));
    Path script=codeRoot.resolve("demoparser2_mysql.py");
    if(!Files.isRegularFile(python)||!Files.isRegularFile(script))throw new IllegalStateException("Python 解析器不存在："+script);
    Path dir=parserRoot.resolve("uploads");Files.createDirectories(dir);
    Path staged=stageDemo(file,dir,lowerName.endsWith(".zip"));
    String demoHash=sha256(staged);Long duplicateId=findDuplicateMatch(demoHash,originalName);
    if(duplicateId!=null){Files.deleteIfExists(staged);return Map.of("status","skipped","matchId",duplicateId,"message","数据库已存在同一 Demo，已跳过解析");}
    if(!activeDemoHashes.add(demoHash)){Files.deleteIfExists(staged);return Map.of("status","skipped","message","相同 Demo 正在解析，已跳过重复任务");}
    String targetName=lowerName.endsWith(".zip")?originalName.substring(0,originalName.length()-4)+".dem":originalName;
    Path target=dir.resolve(targetName);
    try{
      Files.move(staged,target,StandardCopyOption.REPLACE_EXISTING);
      if(recordedAt!=null&&recordedAt>0)Files.setLastModifiedTime(target,FileTime.fromMillis(recordedAt));
      String output="";boolean parsed=false;
      Path diagnosticDir=parserRoot.resolve(".cache").resolve("parser-failures");Files.createDirectories(diagnosticDir);
      for(int attempt=1;attempt<=3&&!parsed;attempt++){
      Path log=Files.createTempFile("csdemo-import-",".log");
      Path stage=Files.createTempFile("csdemo-stage-",".txt");
      try{
        ProcessBuilder pb=new ProcessBuilder(python.toString(),script.toString(),target.toString());
        pb.directory(parserRoot.toFile());pb.redirectErrorStream(true);pb.redirectOutput(log.toFile());
        Map<String,String> env=pb.environment();env.put("CS2_DATABASE",databaseRepository.databaseFile());env.put("DEMO_SHA256",demoHash);env.put("CS2_PARSE_STAGE_FILE",stage.toString());
        Process process=pb.start();boolean finished=process.waitFor(15,TimeUnit.MINUTES);
        if(!finished){process.destroyForcibly();output=Files.readString(log,StandardCharsets.UTF_8);throw new IllegalStateException(saveParserFailure(originalName,attempt,"超时",readParserStage(stage),output,diagnosticDir));}
        output=Files.readString(log,StandardCharsets.UTF_8);
        if(process.exitValue()==0){parsed=true;break;}
        int exitCode=process.exitValue();String lower=output.toLowerCase(Locale.ROOT);boolean transientFailure=lower.contains("deadlock")||lower.contains("lock wait")||lower.contains("operationalerror")||lower.contains("duplicate entry")||lower.contains("database is locked")||lower.contains("sqlite_busy");
        String detail=saveParserFailure(originalName,attempt,exitCode,readParserStage(stage),output,diagnosticDir);
        if(!transientFailure||attempt==3)throw new IllegalStateException(detail);
        Thread.sleep(attempt*1000L);
      }finally{Files.deleteIfExists(log);Files.deleteIfExists(stage);}
      }
      analyticsCache.clear();replayCache.clear();refreshMatchesAsync();return Map.of("status","parsed","fileName",originalName,"demoFingerprint",demoHash,"message","解析完成，Demo 已保存到服务器，可用于回放和 POV 录制","output",output);
    }finally{activeDemoHashes.remove(demoHash);Files.deleteIfExists(staged);}
  }

  private Path stageDemo(MultipartFile file,Path dir,boolean archive)throws IOException{
    Path staged=Files.createTempFile(dir,"demo-upload-",".dem");
    try{
      if(!archive){Files.copy(file.getInputStream(),staged,StandardCopyOption.REPLACE_EXISTING);return staged;}
      Path zip=Files.createTempFile(dir,"demo-upload-",".zip");
      try{Files.copy(file.getInputStream(),zip,StandardCopyOption.REPLACE_EXISTING);extractDemo(zip,staged);}
      finally{Files.deleteIfExists(zip);}
      return staged;
    }catch(IOException|RuntimeException error){Files.deleteIfExists(staged);throw error;}
  }

  private void extractDemo(Path archive,Path staged)throws IOException{
    ZipEntry selected=null;
    try(ZipFile zip=new ZipFile(archive.toFile())){
      Enumeration<? extends ZipEntry> entries=zip.entries();
      while(entries.hasMoreElements()){
        ZipEntry entry=entries.nextElement();
        if(entry.isDirectory())continue;
        String name=entry.getName().replace('\\','/');
        if(!name.toLowerCase(Locale.ROOT).endsWith(".dem"))continue;
        if(selected!=null)throw new IOException("压缩包必须只包含一个 .dem Demo 文件");
        selected=entry;
      }
      if(selected==null)throw new IOException("压缩包内没有 .dem Demo 文件");
      long copied=0,max=512L*1024*1024;
      try(InputStream input=zip.getInputStream(selected);OutputStream output=Files.newOutputStream(staged,StandardOpenOption.TRUNCATE_EXISTING)){
        byte[] buffer=new byte[1024*1024];int read;
        while((read=input.read(buffer))!=-1){copied+=read;if(copied>max)throw new IOException("压缩包内 Demo 超过 512MB");output.write(buffer,0,read);}
      }
    }
  }

  private String readParserStage(Path stage){
    try{return Files.readString(stage,StandardCharsets.UTF_8).trim();}catch(Exception ignored){return "未记录";}
  }
  private String saveParserFailure(String fileName,int attempt,Object exitCode,String stage,String output,Path diagnosticDir){
    long code=exitCode instanceof Number?Integer.toUnsignedLong(((Number)exitCode).intValue()):0L;
    String hex=exitCode instanceof Number?String.format(Locale.ROOT,"0x%08X",code):String.valueOf(exitCode);
    String hint=(code==0xC0000005L||code==0xC0000374L)?"demoparser2 原生模块异常退出（非法内存访问/堆损坏）":"请结合阶段和诊断日志继续排查";
    String text=output==null?"":output.trim();
    if(text.length()>4000)text="…"+text.substring(text.length()-4000);
    String stamp=String.valueOf(System.currentTimeMillis());
    String safe=fileName.replaceAll("[^A-Za-z0-9._-]","_");
    Path saved=diagnosticDir.resolve(stamp+"-"+safe+".log");
    String report="file="+fileName+"\nattempt="+attempt+"\nexitCode="+hex+"\nstage="+stage+"\n\n"+text+"\n";
    try{Files.writeString(saved,report,StandardCharsets.UTF_8);}catch(IOException ignored){}
    return "Demo 解析失败："+fileName+"；阶段："+stage+"；退出码："+hex+"；"+hint+"；"+(text.isBlank()?"未输出额外日志":"最后日志：\n"+text)+"；诊断文件："+saved;
  }

  private String sha256(Path path)throws IOException{
    try{MessageDigest digest=MessageDigest.getInstance("SHA-256");try(var input=Files.newInputStream(path)){byte[] buffer=new byte[1024*1024];for(int read;(read=input.read(buffer))!=-1;)digest.update(buffer,0,read);}return HexFormat.of().formatHex(digest.digest());}
    catch(java.security.NoSuchAlgorithmException e){throw new IllegalStateException("系统不支持 SHA-256",e);}
  }

  /** 每个进程只检查一次指纹列，避免每次上传都执行字段检查或 DDL。 */
  private synchronized void prepareDemoHashes()throws SQLException{
    if(demoHashesPrepared)return;
    try(Connection c=databaseRepository.connection()){
      databaseRepository.ensureDemoFingerprint(c);
    }
    demoHashesPrepared=true;
  }

  private Long findDuplicateMatch(String hash,String fileName)throws SQLException{
    prepareDemoHashes();try(Connection c=databaseRepository.connection();PreparedStatement ps=c.prepareStatement("SELECT m.id FROM matches m WHERE (m.demo_sha256=? OR demo_basename(m.demo_file_path)=?) AND EXISTS (SELECT 1 FROM rounds r WHERE r.match_id=m.id) ORDER BY m.id DESC LIMIT 1")){ps.setString(1,hash);ps.setString(2,fileName);ResultSet rs=ps.executeQuery();return rs.next()?rs.getLong(1):null;}
  }

  /**
   * 计算单场玩家数据。正式边界优先使用 official_start_tick，其次使用热身结束 tick；
   * 结束边界取最后一个有效 round_end，排除热身和赛后退出产生的事件。
   */
  private List<Map<String,Object>> loadPlayers(Connection c,long matchId,Long official,Long warmup)throws SQLException{
    List<Map<String,Object>> players=loadRoster(c,matchId);if(players.isEmpty())return players;
    long start=firstNonZero(official,warmup,scalarLong(c,"SELECT MIN(tick) FROM rounds WHERE match_id=? AND start_type='round_freeze_end'",matchId),scalarLong(c,"SELECT MIN(tick) FROM rounds WHERE match_id=? AND start_type='round_prestart'",matchId),0L);
    long end=scalarLong(c,"SELECT MAX(tick) FROM events WHERE match_id=? AND event_name='round_end' AND JSON_EXTRACT(data_json,'$.winner') IN ('T','CT')",matchId);if(end<=0)end=scalarLong(c,"SELECT MAX(tick) FROM rounds WHERE match_id=? AND start_type='round_officially_ended'",matchId);if(end<=0)end=Long.MAX_VALUE;
    int rounds=scalarInt(c,"SELECT COUNT(DISTINCT tick) FROM events WHERE match_id=? AND event_name='round_end' AND JSON_EXTRACT(data_json,'$.winner') IN ('T','CT') AND tick BETWEEN ? AND ?",matchId,start,end);if(rounds<=0)rounds=scalarInt(c,"SELECT COUNT(DISTINCT tick) FROM rounds WHERE match_id=? AND start_type='round_officially_ended' AND tick BETWEEN ? AND ?",matchId,start,end);if(rounds<=0)rounds=1;
    Map<String,int[]> kills=new HashMap<>();
    try(PreparedStatement ps=c.prepareStatement("SELECT k.attacker_steamid,COUNT(*),COALESCE(SUM(k.headshot),0),SUM(CASE WHEN k.weapon LIKE '%awp%' OR k.weapon LIKE '%ssg%' OR k.weapon LIKE '%scar%' OR k.weapon LIKE '%g3sg1%' THEN 1 ELSE 0 END) FROM kills k JOIN match_players a ON a.match_id=k.match_id AND a.steamid=k.attacker_steamid JOIN match_players v ON v.match_id=k.match_id AND v.steamid=k.victim_steamid WHERE k.match_id=? AND k.tick BETWEEN ? AND ? AND a.team_number<>v.team_number AND k.attacker_steamid<>k.victim_steamid "+validRound("k")+" GROUP BY k.attacker_steamid")){ps.setLong(1,matchId);ps.setLong(2,start);ps.setLong(3,end);ResultSet rs=ps.executeQuery();while(rs.next())kills.put(rs.getString(1),new int[]{rs.getInt(2),rs.getInt(3),rs.getInt(4)});}
    Map<String,Integer> deaths=countBy(c,"SELECT k.victim_steamid,COUNT(*) FROM kills k WHERE k.match_id=? AND k.tick BETWEEN ? AND ? "+validRound("k")+" GROUP BY k.victim_steamid",matchId,start,end);
    Map<String,Integer> assists=countBy(c,"SELECT s.steamid,COUNT(*) FROM kills k JOIN match_players s ON s.match_id=k.match_id AND s.steamid=JSON_EXTRACT(k.data_json,'$.assister_steamid') JOIN match_players v ON v.match_id=k.match_id AND v.steamid=k.victim_steamid WHERE k.match_id=? AND k.tick BETWEEN ? AND ? AND s.team_number<>v.team_number "+validRound("k")+" GROUP BY s.steamid",matchId,start,end);
    Map<String,Double> damage=effectiveDamage(c,matchId,start,end);try(PreparedStatement ps=c.prepareStatement("SELECT steamid,total_damage FROM match_players WHERE match_id=? AND total_damage IS NOT NULL")){ps.setLong(1,matchId);ResultSet rs=ps.executeQuery();while(rs.next())damage.put(rs.getString(1),rs.getDouble(2));}Map<String,Integer> multi=multiKillRounds(c,matchId,start,end);Map<String,Integer> clutches=new HashMap<>();for(Map<String,Object> clutch:loadClutches(c,matchId,start,end))clutches.merge(String.valueOf(clutch.get("steamid")),1,Integer::sum);Map<String,Integer> firstKills=firstKills(c,matchId,start,end),firstDeaths=firstDeaths(c,matchId,start,end),thrown=thrownCount(c,matchId,start,end);Map<String,Double> utilityDamage=utilityDamage(c,matchId,start,end);Map<String,Integer> flashBlind=databaseRepository.flashBlindCounts(c,matchId,start,end);final int rc=rounds;Map<String,Double> we=loadWe(c,matchId,start,end,rc,players,damage,kills,assists);
    for(Map<String,Object> p:players){String sid=(String)p.get("steamid");int[] k=kills.getOrDefault(sid,new int[3]);int d=deaths.getOrDefault(sid,0),a=assists.getOrDefault(sid,0),mk=multi.getOrDefault(sid,0);double adr=damage.getOrDefault(sid,0.0)/rc,kpr=k[0]/(double)rc,dpr=d/(double)rc,apr=a/(double)rc,survival=Math.max(0,1-dpr),impact=Math.max(0,2.13*kpr+0.42*apr-0.41),multiRate=mk/(double)rc;double rating=0.32*(kpr/0.68)+0.18*(survival/0.65)+0.24*(adr/70.0)+0.10*(apr/0.16)+0.10*(impact/1.10)+0.06*(multiRate/0.20);/* Calibrate the custom rating baseline so strong match performances are not compressed below the expected range. */rating=Math.max(0,Math.min(2.50,rating+0.20));p.put("kills",k[0]);p.put("deaths",d);p.put("assists",a);p.put("kda",k[0]+"-"+d+"-"+a);p.put("adr",Math.round(adr*10.0)/10.0);p.put("hs",k[0]==0?0:Math.round(k[1]*1000.0/k[0])/10.0);p.put("aim",k[1]);p.put("rating",Math.round(rating*100.0)/100.0);p.put("we",we.getOrDefault(sid,0.0));p.put("multiKillRounds",mk);p.put("sniperKills",k[2]);p.put("clutchCount",clutches.getOrDefault(sid,0));p.put("flashBlindCount",flashBlind==null?null:flashBlind.getOrDefault(sid,0));p.put("utilityDamage",utilityDamage.getOrDefault(sid,0.0));p.put("firstKills",firstKills.getOrDefault(sid,0));p.put("firstDeaths",firstDeaths.getOrDefault(sid,0));p.put("thrownCount",thrown.getOrDefault(sid,0));p.put("badges",List.of());}
    players.sort((a,b)->Double.compare(num(b.get("rating")),num(a.get("rating"))));return players;
  }

  /** 按 team_number 分组，仅把真实编号映射为前端展示用的 A/B 标签。 */
  private List<Map<String,Object>> loadRoster(Connection c,long id)throws SQLException{List<Map<String,Object>> out=new ArrayList<>();Map<Integer,String> labels=new LinkedHashMap<>();try(PreparedStatement ps=c.prepareStatement("SELECT mp.steamid,p.name,mp.team_number FROM match_players mp LEFT JOIN players p ON p.steamid=mp.steamid WHERE mp.match_id=? ORDER BY mp.team_number,mp.rowid")){ps.setLong(1,id);ResultSet rs=ps.executeQuery();while(rs.next()){int tn=rs.getInt(3);labels.computeIfAbsent(tn,n->labels.isEmpty()?"A":"B");Map<String,Object> p=new LinkedHashMap<>();p.put("steamid",rs.getString(1));p.put("name",Optional.ofNullable(rs.getString(2)).orElse(rs.getString(1)));p.put("team",labels.get(tn));p.put("teamNumber",tn);p.put("kills",0);p.put("deaths",0);p.put("assists",0);p.put("kda","0-0-0");p.put("adr",0.0);p.put("hs",0.0);p.put("aim",0);p.put("rating",0.0);p.put("we",0);p.put("badges",List.of());out.add(p);}}return out;}

  /**
   * 计算有效敌方伤害。同一正式回合内，同一受害者累计最多贡献 100 点生命伤害，
   * 从而避免多名攻击者对同一受害者的伤害总和超过其可用生命值。
   */
  private Map<String,Double> effectiveDamage(Connection c,long id,long start,long end)throws SQLException{Map<String,Double> out=new HashMap<>(),received=new HashMap<>();try(PreparedStatement ps=c.prepareStatement("SELECT d.attacker_steamid,d.victim_steamid,d.health_damage,1+(SELECT COUNT(*) FROM events re WHERE re.match_id=d.match_id AND re.event_name='round_end' AND JSON_EXTRACT(re.data_json,'$.winner') IN ('T','CT') AND re.tick<d.tick) FROM damages d JOIN match_players a ON a.match_id=d.match_id AND a.steamid=d.attacker_steamid JOIN match_players v ON v.match_id=d.match_id AND v.steamid=d.victim_steamid WHERE d.match_id=? AND d.tick BETWEEN ? AND ? AND a.team_number<>v.team_number "+validRound("d")+" ORDER BY d.tick,d.id")){ps.setLong(1,id);ps.setLong(2,start);ps.setLong(3,end);ResultSet rs=ps.executeQuery();while(rs.next()){String attacker=rs.getString(1),key=rs.getInt(4)+":"+rs.getString(2);double used=received.getOrDefault(key,0.0),allowed=Math.max(0,Math.min(Math.max(0,rs.getDouble(3)),100-used));if(allowed>0){received.put(key,used+allowed);out.merge(attacker,allowed,Double::sum);}}}return out;}
  private Map<String,Integer> multiKillRounds(Connection c,long id,long start,long end)throws SQLException{Map<String,Integer> out=new HashMap<>();try(PreparedStatement ps=c.prepareStatement("SELECT attacker_steamid,COUNT(*) FROM (SELECT k.attacker_steamid,1+(SELECT COUNT(*) FROM events e WHERE e.match_id=k.match_id AND e.event_name='round_end' AND JSON_EXTRACT(e.data_json,'$.winner') IN ('T','CT') AND e.tick<k.tick) rn,COUNT(*) kills FROM kills k JOIN match_players a ON a.match_id=k.match_id AND a.steamid=k.attacker_steamid JOIN match_players v ON v.match_id=k.match_id AND v.steamid=k.victim_steamid WHERE k.match_id=? AND k.tick BETWEEN ? AND ? AND a.team_number<>v.team_number AND k.attacker_steamid<>k.victim_steamid "+validRound("k")+" GROUP BY k.attacker_steamid,rn HAVING COUNT(*)>=3) x GROUP BY attacker_steamid")){ps.setLong(1,id);ps.setLong(2,start);ps.setLong(3,end);ResultSet rs=ps.executeQuery();while(rs.next())out.put(rs.getString(1),rs.getInt(2));}return out;}
  private Map<String,Integer> firstKills(Connection c,long id,long start,long end)throws SQLException{Map<String,Integer> out=new HashMap<>();List<Long> ends=new ArrayList<>();try(PreparedStatement ps=c.prepareStatement("SELECT DISTINCT tick FROM events WHERE match_id=? AND event_name='round_end' AND JSON_EXTRACT(data_json,'$.winner') IN ('T','CT') AND tick BETWEEN ? AND ? ORDER BY tick")){ps.setLong(1,id);ps.setLong(2,start);ps.setLong(3,end);ResultSet rs=ps.executeQuery();while(rs.next())ends.add(rs.getLong(1));}if(ends.isEmpty())return out;Set<Integer> seen=new HashSet<>();int round=0;try(PreparedStatement ps=c.prepareStatement("SELECT tick,attacker_steamid FROM kills k JOIN match_players a ON a.match_id=k.match_id AND a.steamid=k.attacker_steamid JOIN match_players v ON v.match_id=k.match_id AND v.steamid=k.victim_steamid WHERE k.match_id=? AND k.tick BETWEEN ? AND ? AND a.team_number<>v.team_number AND k.attacker_steamid<>k.victim_steamid "+validRound("k")+" ORDER BY k.tick,k.id")){ps.setLong(1,id);ps.setLong(2,start);ps.setLong(3,end);ResultSet rs=ps.executeQuery();while(rs.next()){long tick=rs.getLong(1);while(round<ends.size()&&tick>ends.get(round))round++;String sid=rs.getString(2);if(round<ends.size()&&seen.add(round)&&sid!=null)out.merge(sid,1,Integer::sum);}}return out;}
  private Map<String,Integer> firstDeaths(Connection c,long id,long start,long end)throws SQLException{Map<String,Integer> out=new HashMap<>();List<Long> ends=new ArrayList<>();try(PreparedStatement ps=c.prepareStatement("SELECT DISTINCT tick FROM events WHERE match_id=? AND event_name='round_end' AND JSON_EXTRACT(data_json,'$.winner') IN ('T','CT') AND tick BETWEEN ? AND ? ORDER BY tick")){ps.setLong(1,id);ps.setLong(2,start);ps.setLong(3,end);ResultSet rs=ps.executeQuery();while(rs.next())ends.add(rs.getLong(1));}Set<Integer> seen=new HashSet<>();int round=0;try(PreparedStatement ps=c.prepareStatement("SELECT tick,victim_steamid FROM kills k WHERE k.match_id=? AND k.tick BETWEEN ? AND ? "+validRound("k")+" ORDER BY k.tick,k.id")){ps.setLong(1,id);ps.setLong(2,start);ps.setLong(3,end);ResultSet rs=ps.executeQuery();while(rs.next()){long tick=rs.getLong(1);while(round<ends.size()&&tick>ends.get(round))round++;String sid=rs.getString(2);if(round<ends.size()&&seen.add(round)&&sid!=null)out.merge(sid,1,Integer::sum);}}return out;}
  private Map<String,Integer> thrownCount(Connection c,long id,long start,long end)throws SQLException{Map<String,Integer> out=new HashMap<>();try(PreparedStatement ps=c.prepareStatement("SELECT JSON_EXTRACT(data_json,'$.user_steamid'),COUNT(*) FROM events WHERE match_id=? AND tick BETWEEN ? AND ? AND event_name IN ('hegrenade_detonate','flashbang_detonate','smokegrenade_detonate','inferno_startburn','decoy_started') AND JSON_EXTRACT(data_json,'$.user_steamid') IS NOT NULL "+validRound("events")+" GROUP BY JSON_EXTRACT(data_json,'$.user_steamid')")){ps.setLong(1,id);ps.setLong(2,start);ps.setLong(3,end);ResultSet rs=ps.executeQuery();while(rs.next())out.put(rs.getString(1),rs.getInt(2));}return out;}
  private Map<String,Double> utilityDamage(Connection c,long id,long start,long end)throws SQLException{Map<String,Double> out=new HashMap<>();String weapons="LOWER(COALESCE(JSON_EXTRACT(d.data_json,'$.weapon'),'')) LIKE '%hegrenade%' OR LOWER(COALESCE(JSON_EXTRACT(d.data_json,'$.weapon'),'')) LIKE '%inferno%' OR LOWER(COALESCE(JSON_EXTRACT(d.data_json,'$.weapon'),'')) LIKE '%molotov%' OR LOWER(COALESCE(JSON_EXTRACT(d.data_json,'$.weapon'),'')) LIKE '%incgrenade%'";try(PreparedStatement ps=c.prepareStatement("SELECT d.attacker_steamid,COALESCE(SUM(d.health_damage),0) FROM damages d JOIN match_players a ON a.match_id=d.match_id AND a.steamid=d.attacker_steamid JOIN match_players v ON v.match_id=d.match_id AND v.steamid=d.victim_steamid WHERE d.match_id=? AND d.tick BETWEEN ? AND ? AND a.team_number<>v.team_number AND ("+weapons+") "+validRound("d")+" GROUP BY d.attacker_steamid")){ps.setLong(1,id);ps.setLong(2,start);ps.setLong(3,end);ResultSet rs=ps.executeQuery();while(rs.next())out.put(rs.getString(1),rs.getDouble(2));}return out;}
  private Map<String,Object> loadAnalytics(Connection c,long id)throws SQLException{
    long start=scalarLong(c,"SELECT COALESCE(official_start_tick,warmup_end_tick,0) FROM matches WHERE id=?",id),end=scalarLong(c,"SELECT MAX(tick) FROM events WHERE match_id=? AND event_name='round_end' AND JSON_EXTRACT(data_json,'$.winner') IN ('T','CT')",id);if(end<=0)end=scalarLong(c,"SELECT MAX(tick) FROM rounds WHERE match_id=? AND start_type='round_officially_ended'",id);if(end<=0)end=Long.MAX_VALUE;
    Map<String,Object> out=new LinkedHashMap<>();List<Map<String,Object>> weapons=new ArrayList<>(),rounds=new ArrayList<>(),highlights=new ArrayList<>();
    try(PreparedStatement ps=c.prepareStatement("SELECT "+normalizedWeaponSql("k")+" normalized_weapon,COUNT(*) kills,COALESCE(SUM(k.headshot),0) headshots FROM kills k JOIN match_players a ON a.match_id=k.match_id AND a.steamid=k.attacker_steamid JOIN match_players v ON v.match_id=k.match_id AND v.steamid=k.victim_steamid WHERE k.match_id=? AND k.tick BETWEEN ? AND ? AND a.team_number<>v.team_number AND k.attacker_steamid<>k.victim_steamid "+validRound("k")+" GROUP BY normalized_weapon ORDER BY kills DESC LIMIT 20")){ps.setLong(1,id);ps.setLong(2,start);ps.setLong(3,end);ResultSet rs=ps.executeQuery();while(rs.next())weapons.add(Map.of("weapon",Optional.ofNullable(rs.getString(1)).orElse("unknown"),"kills",rs.getInt(2),"headshots",rs.getInt(3)));}
    try(PreparedStatement ps=c.prepareStatement("SELECT DISTINCT tick FROM events WHERE match_id=? AND event_name='round_end' AND JSON_EXTRACT(data_json,'$.winner') IN ('T','CT') AND tick BETWEEN ? AND ? ORDER BY tick")){ps.setLong(1,id);ps.setLong(2,start);ps.setLong(3,end);ResultSet rs=ps.executeQuery();int n=1;while(rs.next()){long tick=rs.getLong(1);rounds.add(Map.of("round",n++,"tick",tick,"timeSeconds",Math.max(0,(tick-start)/64)));}}
    try(PreparedStatement ps=c.prepareStatement("SELECT attacker_name,attacker_steamid,rn,kills FROM (SELECT k.attacker_name,k.attacker_steamid,1+(SELECT COUNT(*) FROM events e WHERE e.match_id=k.match_id AND e.event_name='round_end' AND JSON_EXTRACT(e.data_json,'$.winner') IN ('T','CT') AND e.tick<k.tick) rn,COUNT(*) kills FROM kills k JOIN match_players a ON a.match_id=k.match_id AND a.steamid=k.attacker_steamid JOIN match_players v ON v.match_id=k.match_id AND v.steamid=k.victim_steamid WHERE k.match_id=? AND k.tick BETWEEN ? AND ? AND a.team_number<>v.team_number AND k.attacker_steamid<>k.victim_steamid "+validRound("k")+" GROUP BY k.attacker_name,k.attacker_steamid,rn HAVING COUNT(*)>=3) x ORDER BY kills DESC,rn LIMIT 30")){ps.setLong(1,id);ps.setLong(2,start);ps.setLong(3,end);ResultSet rs=ps.executeQuery();while(rs.next()){Map<String,Object> h=new LinkedHashMap<>();h.put("player",rs.getString(1));h.put("steamid",rs.getString(2));h.put("round",rs.getInt(3));h.put("kills",rs.getInt(4));highlights.add(h);}}
    int ctWins=scalarInt(c,"SELECT COUNT(DISTINCT tick) FROM events WHERE match_id=? AND event_name='round_end' AND JSON_EXTRACT(data_json,'$.winner')='CT' AND tick BETWEEN ? AND ?",id,start,end),tWins=scalarInt(c,"SELECT COUNT(DISTINCT tick) FROM events WHERE match_id=? AND event_name='round_end' AND JSON_EXTRACT(data_json,'$.winner')='T' AND tick BETWEEN ? AND ?",id,start,end);
    out.put("weapons",weapons);out.put("rounds",rounds);out.put("highlights",highlights);out.put("clutches",loadClutches(c,id,start,end));out.put("roundCount",rounds.size());out.put("ctWins",ctWins);out.put("tWins",tWins);out.put("startTick",start);out.put("endTick",end==Long.MAX_VALUE?null:end);return out;
  }

  /** 回放每回合存活状态，仅记录进入 1vX 且最终赢下该回合的玩家。 */
  private List<Map<String,Object>> loadClutches(Connection c,long id,long matchStart,long matchEnd)throws SQLException{
    Map<String,Integer> playerTeam=new HashMap<>();Map<String,String> names=new HashMap<>();Map<Integer,LinkedHashSet<String>> rosters=new LinkedHashMap<>();
    try(PreparedStatement ps=c.prepareStatement("SELECT mp.steamid,mp.team_number,p.name FROM match_players mp LEFT JOIN players p ON p.steamid=mp.steamid WHERE mp.match_id=?")){ps.setLong(1,id);ResultSet rs=ps.executeQuery();while(rs.next()){String sid=rs.getString(1);int team=rs.getInt(2);playerTeam.put(sid,team);names.put(sid,Optional.ofNullable(rs.getString(3)).orElse(sid));rosters.computeIfAbsent(team,k->new LinkedHashSet<>()).add(sid);}}
    if(rosters.size()!=2)return List.of();
    List<Long> starts=new ArrayList<>(),ends=new ArrayList<>();
    try(PreparedStatement ps=c.prepareStatement("SELECT DISTINCT tick FROM events WHERE match_id=? AND event_name='round_freeze_end' AND tick BETWEEN ? AND ? ORDER BY tick")){ps.setLong(1,id);ps.setLong(2,matchStart);ps.setLong(3,matchEnd);ResultSet rs=ps.executeQuery();while(rs.next())starts.add(rs.getLong(1));}
    try(PreparedStatement ps=c.prepareStatement("SELECT DISTINCT tick FROM events WHERE match_id=? AND event_name=CASE WHEN EXISTS(SELECT 1 FROM events x WHERE x.match_id=? AND x.event_name='round_end') THEN 'round_end' ELSE 'round_officially_ended' END AND tick BETWEEN ? AND ? ORDER BY tick")){ps.setLong(1,id);ps.setLong(2,id);ps.setLong(3,matchStart);ps.setLong(4,matchEnd);ResultSet rs=ps.executeQuery();while(rs.next())ends.add(rs.getLong(1));}
    List<Map<String,Object>> result=new ArrayList<>();int endIndex=0;
    for(int roundIndex=0;roundIndex<starts.size();roundIndex++){
      long roundStart=starts.get(roundIndex);while(endIndex<ends.size()&&ends.get(endIndex)<roundStart)endIndex++;if(endIndex>=ends.size())break;long roundEnd=ends.get(endIndex++);if(roundIndex+1<starts.size()&&roundEnd>=starts.get(roundIndex+1))continue;
      Map<Integer,LinkedHashSet<String>> alive=new LinkedHashMap<>();for(var entry:rosters.entrySet())alive.put(entry.getKey(),new LinkedHashSet<>(entry.getValue()));Map<String,Integer> candidates=new HashMap<>();
      try(PreparedStatement ps=c.prepareStatement("SELECT attacker_steamid,victim_steamid FROM kills WHERE match_id=? AND tick BETWEEN ? AND ? ORDER BY tick,id")){ps.setLong(1,id);ps.setLong(2,roundStart);ps.setLong(3,roundEnd);ResultSet rs=ps.executeQuery();while(rs.next()){String victim=rs.getString(2);Integer victimTeam=playerTeam.get(victim);if(victimTeam==null)continue;alive.get(victimTeam).remove(victim);for(var entry:alive.entrySet()){if(entry.getValue().size()!=1)continue;int opponents=alive.entrySet().stream().filter(x->!x.getKey().equals(entry.getKey())).mapToInt(x->x.getValue().size()).sum();if(opponents>0)candidates.putIfAbsent(entry.getValue().iterator().next(),opponents);}}}
      Integer winner=null;
      try(PreparedStatement ps=c.prepareStatement("SELECT event_name,player_steamid,JSON_EXTRACT(data_json,'$.winner') FROM events WHERE match_id=? AND tick BETWEEN ? AND ? AND event_name IN ('bomb_defused','bomb_exploded','round_end') ORDER BY tick DESC")){ps.setLong(1,id);ps.setLong(2,roundStart);ps.setLong(3,roundEnd);ResultSet rs=ps.executeQuery();while(rs.next()){String event=rs.getString(1),sid=rs.getString(2);if((event.equals("bomb_defused")||event.equals("bomb_exploded"))&&playerTeam.containsKey(sid)){winner=playerTeam.get(sid);break;}if(event.equals("round_end")&&winner==null){try{String value=rs.getString(3);int side="T".equalsIgnoreCase(value)?2:"CT".equalsIgnoreCase(value)?3:Integer.parseInt(value);boolean swapped=sidesDifferFromFinal(roundIndex+1,ends.size());winner=swapped?rosters.keySet().stream().filter(t->t!=side).findFirst().orElse(null):side;}catch(Exception ignored){}}}}
      if(winner==null){List<Integer> living=alive.entrySet().stream().filter(x->!x.getValue().isEmpty()).map(Map.Entry::getKey).toList();if(living.size()==1)winner=living.get(0);}
      if(winner==null)continue;for(var candidate:candidates.entrySet()){String sid=candidate.getKey();if(Objects.equals(playerTeam.get(sid),winner)&&alive.get(winner).contains(sid)){Map<String,Object> clutch=new LinkedHashMap<>();clutch.put("round",roundIndex+1);clutch.put("player",names.get(sid));clutch.put("steamid",sid);clutch.put("x",candidate.getValue());result.add(clutch);}}
    }
    result.sort((a,b)->Integer.compare((int)b.get("x"),(int)a.get("x")));return result;
  }
  private Map<String,Integer> countBy(Connection c,String sql,long id,long start,long end)throws SQLException{Map<String,Integer> out=new HashMap<>();try(PreparedStatement ps=c.prepareStatement(sql)){ps.setLong(1,id);ps.setLong(2,start);ps.setLong(3,end);ResultSet rs=ps.executeQuery();while(rs.next())if(rs.getString(1)!=null)out.put(rs.getString(1),rs.getInt(2));}return out;}
  private long scalarLong(Connection c,String sql,long id)throws SQLException{try(PreparedStatement ps=c.prepareStatement(sql)){ps.setLong(1,id);ResultSet rs=ps.executeQuery();return rs.next()?rs.getLong(1):0;}}
  private int scalarInt(Connection c,String sql,long id,long start,long end)throws SQLException{try(PreparedStatement ps=c.prepareStatement(sql)){ps.setLong(1,id);ps.setLong(2,start);ps.setLong(3,end);ResultSet rs=ps.executeQuery();return rs.next()?rs.getInt(1):0;}}
  private Long nullableLong(ResultSet rs,String col)throws SQLException{long v=rs.getLong(col);return rs.wasNull()?null:v;}
  private long firstNonZero(Long... values){for(Long v:values)if(v!=null&&v>0)return v;return 0;}
  /** 常规赛第 12 回合后换边；连续 MR3 加时在每个新加时段沿用上一段末侧别，半场边界为 27、33、39……。 */
  private boolean sidesDifferFromFinal(int roundNumber,int totalRounds){int swaps=roundNumber<=12&&totalRounds>12?1:0;for(int boundary=27;boundary<totalRounds;boundary+=6)if(roundNumber<=boundary)swaps++;return swaps%2==1;}
  private double num(Object v){return v instanceof Number n?n.doubleValue():0;}
  /**
   * 自定义 WE 是绝对贡献分：4×ADR/100 + 3×KPR + APR + 2×本队回合胜率。
   * 换边前后的阵营胜者会映射回固定 team_number，避免把 T/CT 当成队伍身份。
   */
  private Map<String,Double> loadWe(Connection c,long id,long start,long end,int roundCount,List<Map<String,Object>> players,Map<String,Double> damage,Map<String,int[]> kills,Map<String,Integer> assists)throws SQLException{
    Map<String,Integer> teams=new HashMap<>();for(Map<String,Object> player:players)teams.put(String.valueOf(player.get("steamid")),((Number)player.get("teamNumber")).intValue());
    List<String> roundWinners=new ArrayList<>();
    try(PreparedStatement ps=c.prepareStatement("SELECT tick,JSON_EXTRACT(data_json,'$.winner') winner FROM events WHERE match_id=? AND event_name='round_end' AND JSON_EXTRACT(data_json,'$.winner') IN ('T','CT') AND tick BETWEEN ? AND ? GROUP BY tick,winner ORDER BY tick")){
      ps.setLong(1,id);ps.setLong(2,start);ps.setLong(3,end);ResultSet rs=ps.executeQuery();while(rs.next())roundWinners.add(rs.getString(2));
    }
    Map<Integer,Integer> teamWins=new HashMap<>();
    for(int index=0;index<roundWinners.size();index++){
      int side="T".equalsIgnoreCase(roundWinners.get(index))?2:3;
      int winner=sidesDifferFromFinal(index+1,roundWinners.size())?oppositeSide(side):side;
      teamWins.merge(winner,1,Integer::sum);
    }
    Map<String,Double> scores=new HashMap<>();
    for(Map<String,Object> player:players){
      String sid=String.valueOf(player.get("steamid"));int team=teams.get(sid),playerKills=kills.getOrDefault(sid,new int[3])[0],playerAssists=assists.getOrDefault(sid,0);
      double adr=damage.getOrDefault(sid,0.0)/Math.max(1,roundCount),kpr=playerKills/(double)Math.max(1,roundCount),apr=playerAssists/(double)Math.max(1,roundCount),roundWinRate=teamWins.getOrDefault(team,0)/(double)Math.max(1,roundCount);
      double value=4.0*(adr/100.0)+3.0*kpr+apr+2.0*roundWinRate;
      scores.put(sid,Math.round(Math.max(0,Math.min(16,value))*10.0)/10.0);
    }
    return scores;
  }

  /** SQL 片段：事件之后最近的 round_end 必须有有效胜方，借此排除赛后事件。 */
  private String validRound(String alias){return " AND COALESCE((SELECT JSON_EXTRACT(re.data_json,'$.winner') FROM events re WHERE re.match_id="+alias+".match_id AND re.event_name='round_end' AND re.tick>="+alias+".tick ORDER BY re.tick,re.id LIMIT 1),'') IN ('T','CT') ";}
  /** 在数据库聚合前统一武器别名、皮肤后缀和全部刀具变体。 */
  public Map<String,Object> replay(long id, int roundNumber, long tick) throws SQLException {
    long requestedTick=tick;
    String replayKey=id+":"+roundNumber+":"+(Math.max(0,requestedTick)/4);
    Map<String,Object> cachedReplay=replayCache.get(replayKey);
    if(cachedReplay!=null)return cachedReplay;
    Map<String,Object> out=new LinkedHashMap<>();
    try(Connection c=databaseRepository.connection()){
      long officialStart=scalarLong(c,"SELECT COALESCE(official_start_tick,warmup_end_tick,0) FROM matches WHERE id=?",id);
      // Replay-only boundary: some servers emit round_announce_match_start
      // during warmup. Keep stored officialStart unchanged for match panels,
      // but start the 2D replay at the first round_prestart after it.
      long replayStart=officialStart, firstFreeze=officialStart;
      try(PreparedStatement ps=c.prepareStatement("SELECT MIN(tick) FROM events WHERE match_id=? AND event_name='round_freeze_end' AND COALESCE(is_warmup,0)=0 AND tick>=?")){
        ps.setLong(1,id);ps.setLong(2,officialStart);
        try(ResultSet rs=ps.executeQuery()){if(rs.next()&&rs.getObject(1)!=null)firstFreeze=rs.getLong(1);}
      }
      try(PreparedStatement ps=c.prepareStatement("SELECT MAX(tick) FROM events WHERE match_id=? AND event_name='round_prestart' AND tick<=?")){
        ps.setLong(1,id);ps.setLong(2,firstFreeze);
        try(ResultSet rs=ps.executeQuery()){if(rs.next()&&rs.getObject(1)!=null)replayStart=rs.getLong(1);}
      }
      List<Long> ends=new ArrayList<>();
      List<String> winners=new ArrayList<>();
      try(PreparedStatement ps=c.prepareStatement("SELECT tick,MAX(JSON_EXTRACT(data_json,'$.winner')) FROM events WHERE match_id=? AND event_name='round_end' AND COALESCE(is_warmup,0)=0 AND tick>=? AND JSON_EXTRACT(data_json,'$.winner') IN ('T','CT') GROUP BY tick ORDER BY tick")){
        ps.setLong(1,id);ps.setLong(2,replayStart);
        try(ResultSet rs=ps.executeQuery()){while(rs.next()){ends.add(rs.getLong(1));winners.add(rs.getString(2));}}
      }
      if(ends.isEmpty())throw new SQLException("No official rounds available for replay");
      int totalRounds=ends.size();
      roundNumber=Math.max(1,Math.min(roundNumber,totalRounds));
      long lower=roundNumber==1?replayStart:ends.get(roundNumber-2)+1;
      long start=lower,end=ends.get(roundNumber-1);
      long playbackEnd=end;
      // Keep the post-win hold (weapon pickup/round transition) in the
      // timeline. ESL demos can omit round_prestart, while
      // round_officially_ended remains the authoritative end of that hold.
      try(PreparedStatement ps=c.prepareStatement("SELECT MIN(tick) FROM events WHERE match_id=? AND event_name IN ('round_officially_ended','round_prestart') AND tick>? AND COALESCE(is_warmup,0)=0")){
        ps.setLong(1,id);ps.setLong(2,end);
        try(ResultSet rs=ps.executeQuery()){if(rs.next()&&rs.getObject(1)!=null)playbackEnd=rs.getLong(1);}
      }
      // Pair phase events inside the official round window, never by table offsets.
      boolean phaseStartFound=false;
      try(PreparedStatement ps=c.prepareStatement("SELECT MIN(tick) FROM events WHERE match_id=? AND event_name='round_prestart' AND tick BETWEEN ? AND ?")){
        ps.setLong(1,id);ps.setLong(2,lower);ps.setLong(3,end);
        try(ResultSet rs=ps.executeQuery()){if(rs.next()&&rs.getObject(1)!=null){start=rs.getLong(1);phaseStartFound=true;}}
      }
      // HLTV/ESL demos can omit round_prestart while still recording the
      // authoritative round_officially_ended boundary. Do not let the
      // previous round's post-end hold frame become the next round's buy time.
      if(!phaseStartFound){
        try(PreparedStatement ps=c.prepareStatement("SELECT MIN(tick) FROM events WHERE match_id=? AND event_name='round_officially_ended' AND tick BETWEEN ? AND ?")){
          ps.setLong(1,id);ps.setLong(2,lower);ps.setLong(3,end);
          try(ResultSet rs=ps.executeQuery()){if(rs.next()&&rs.getObject(1)!=null)start=rs.getLong(1);}
        }
      }
      Long freezeEnd=null;
      try(PreparedStatement ps=c.prepareStatement("SELECT MIN(tick) FROM events WHERE match_id=? AND event_name='round_freeze_end' AND tick BETWEEN ? AND ?")){
        ps.setLong(1,id);ps.setLong(2,start);ps.setLong(3,end);
        try(ResultSet rs=ps.executeQuery()){if(rs.next()&&rs.getObject(1)!=null)freezeEnd=rs.getLong(1);}
      }
      // A freeze event at start is valid. Missing events stay unknown; adding
      // 15 seconds would incorrectly mark an already-live round as buying.
      tick=Math.max(start,Math.min(tick,playbackEnd));
      // 5E demos may write the first player coordinate after the buy phase. Use only this round's first sample for the opening frame.
      try(PreparedStatement firstRoundPos=c.prepareStatement("SELECT MIN(tick) FROM player_positions WHERE match_id=? AND tick>=? AND tick<=? AND x IS NOT NULL AND y IS NOT NULL")){firstRoundPos.setLong(1,id);firstRoundPos.setLong(2,start);firstRoundPos.setLong(3,playbackEnd);try(ResultSet rs=firstRoundPos.executeQuery()){if(rs.next()&&rs.getObject(1)!=null){long first=rs.getLong(1);if(tick<first)tick=first;}}}

      // The native position stream reports an entity as not alive while it
      // is still waiting for its round spawn during freeze time. For replay
      // state, a player is dead only after a player_death row in this round
      // has occurred. This keeps the opening freeze frame from showing live
      // players as corpses.
      Set<String> deadPlayers=new HashSet<>();
      try(PreparedStatement deaths=c.prepareStatement("SELECT DISTINCT victim_steamid FROM kills WHERE match_id=? AND tick BETWEEN ? AND ? AND victim_steamid IS NOT NULL")){
        deaths.setLong(1,id);deaths.setLong(2,start);deaths.setLong(3,tick);
        try(ResultSet rs=deaths.executeQuery()){while(rs.next())if(rs.getString(1)!=null)deadPlayers.add(rs.getString(1));}
      }
      List<Map<String,Object>> players=new ArrayList<>();
      try(PreparedStatement roster=c.prepareStatement("SELECT p.steamid,COALESCE(mp.display_name,p.name),mp.team_number FROM match_players mp LEFT JOIN players p ON p.steamid=mp.steamid WHERE mp.match_id=? ORDER BY mp.team_number,mp.rowid")){roster.setLong(1,id);ResultSet rr=roster.executeQuery();while(rr.next()){Map<String,Object> x=new LinkedHashMap<>();String sid=rr.getString(1);x.put("steamid",sid);x.put("name",Optional.ofNullable(rr.getString(2)).orElse(sid));x.put("teamNumber",rr.getInt(3));try(PreparedStatement pos=c.prepareStatement("SELECT (SELECT pp.x FROM player_positions pp WHERE pp.match_id=? AND pp.steamid=? AND pp.tick<=? AND pp.x IS NOT NULL AND pp.y IS NOT NULL ORDER BY pp.tick DESC LIMIT 1),(SELECT pp.y FROM player_positions pp WHERE pp.match_id=? AND pp.steamid=? AND pp.tick<=? AND pp.x IS NOT NULL AND pp.y IS NOT NULL ORDER BY pp.tick DESC LIMIT 1),(SELECT pp.z FROM player_positions pp WHERE pp.match_id=? AND pp.steamid=? AND pp.tick<=? AND pp.x IS NOT NULL AND pp.y IS NOT NULL ORDER BY pp.tick DESC LIMIT 1),(SELECT pp.yaw FROM player_positions pp WHERE pp.match_id=? AND pp.steamid=? AND pp.tick<=? AND pp.x IS NOT NULL AND pp.y IS NOT NULL ORDER BY pp.tick DESC LIMIT 1),health,armor,alive,money,weapon,inventory,(SELECT COUNT(*) FROM kills k WHERE k.match_id=? AND k.attacker_steamid=? AND k.tick>=COALESCE((SELECT official_start_tick FROM matches m0 WHERE m0.id=k.match_id),0) AND k.tick<=?) AS kills,(SELECT COUNT(*) FROM kills k WHERE k.match_id=? AND k.victim_steamid=? AND k.tick>=COALESCE((SELECT official_start_tick FROM matches m0 WHERE m0.id=k.match_id),0) AND k.tick<=?) AS deaths,(SELECT COUNT(*) FROM kills k WHERE k.match_id=? AND JSON_EXTRACT(k.data_json,'$.assister_steamid')=? AND k.tick>=COALESCE((SELECT official_start_tick FROM matches m0 WHERE m0.id=k.match_id),0) AND k.tick<=?) AS assists FROM player_positions WHERE match_id=? AND steamid=? AND tick<=? ORDER BY tick DESC LIMIT 1")){pos.setLong(1,id);pos.setString(2,sid);pos.setLong(3,tick);pos.setLong(4,id);pos.setString(5,sid);pos.setLong(6,tick);pos.setLong(7,id);pos.setString(8,sid);pos.setLong(9,tick);pos.setLong(10,id);pos.setString(11,sid);pos.setLong(12,tick);pos.setLong(13,id);pos.setString(14,sid);pos.setLong(15,tick);pos.setLong(16,id);pos.setString(17,sid);pos.setLong(18,tick);pos.setLong(19,id);pos.setString(20,sid);pos.setLong(21,tick);pos.setLong(22,id);pos.setString(23,sid);pos.setLong(24,tick);ResultSet pr=pos.executeQuery();if(pr.next()){x.put("x",pr.getObject(1));x.put("y",pr.getObject(2));x.put("z",pr.getObject(3));x.put("yaw",pr.getObject(4));x.put("health",pr.getObject(5));x.put("armor",pr.getObject(6));boolean dead=deadPlayers.contains(sid)||(pr.getObject(5)!=null&&pr.getInt(5)<=0);x.put("alive",!dead);x.put("money",pr.getObject(8));x.put("weapon",pr.getObject(9));x.put("inventory",pr.getObject(10));int k=pr.getInt(11),d=pr.getInt(12),a=pr.getInt(13);x.put("kills",k);x.put("deaths",d);x.put("assists",a);x.put("kda",k+"/"+d+"/"+a);}}players.add(x);}}
       List<Map<String,Object>> events=new ArrayList<>();
       try(PreparedStatement ps=c.prepareStatement("SELECT event_name,tick,player_steamid,player_name,data_json FROM events WHERE match_id=? AND (tick BETWEEN ? AND ? OR event_name='replay_effects_ready') ORDER BY tick,id")){ps.setLong(1,id);ps.setLong(2,start);ps.setLong(3,playbackEnd==Long.MAX_VALUE?Long.MAX_VALUE:playbackEnd);ResultSet rs=ps.executeQuery();while(rs.next()){
         String eventType=rs.getString(1);
         long eventTick=rs.getLong(2);
         String eventSteamid=rs.getString(3);
         String eventData=rs.getString(5);
         // Older parsers may not persist bomb world coordinates. Resolve the
         // planter's last position at the plant tick once, so the C4 marker
         // stays at the planted location instead of following the player.
         if("bomb_planted".equals(eventType)){
           Map<String,Object> payload=new LinkedHashMap<>();
           try{if(eventData!=null&&!eventData.isBlank())payload=objectMapper.readValue(eventData,new TypeReference<Map<String,Object>>(){});}catch(Exception ignored){}
           String positionSteamid=eventSteamid;
           if((positionSteamid==null||positionSteamid.isBlank())&&payload.get("user_steamid")!=null)positionSteamid=String.valueOf(payload.get("user_steamid"));
           Object px=payload.get("user_X"),py=payload.get("user_Y");
           boolean hasX=px instanceof Number&&Double.isFinite(((Number)px).doubleValue());
           boolean hasY=py instanceof Number&&Double.isFinite(((Number)py).doubleValue());
           if((!hasX||!hasY)&&positionSteamid!=null&&!positionSteamid.isBlank()){
             try(PreparedStatement position=c.prepareStatement("SELECT x,y,z FROM player_positions WHERE match_id=? AND steamid=? AND tick<=? AND x IS NOT NULL AND y IS NOT NULL ORDER BY tick DESC LIMIT 1")){
               position.setLong(1,id);position.setString(2,positionSteamid);position.setLong(3,eventTick);
                try(ResultSet point=position.executeQuery()){if(point.next()){payload.put("user_X",point.getObject(1));payload.put("user_Y",point.getObject(2));payload.put("user_Z",point.getObject(3));}}
             }catch(Exception ignored){}
           }
            // Expose a stable coordinate contract to the web replay. The
            // parser historically used user_X/user_Y, while newer effects
            // code consumes x/y; keeping both fields makes old and imported
            // demos render the same fixed C4 location.
            if(payload.get("x")==null&&payload.get("user_X")!=null)payload.put("x",payload.get("user_X"));
            if(payload.get("y")==null&&payload.get("user_Y")!=null)payload.put("y",payload.get("user_Y"));
            if(payload.get("z")==null&&payload.get("user_Z")!=null)payload.put("z",payload.get("user_Z"));
            try{eventData=objectMapper.writeValueAsString(payload);}catch(Exception ignored){}
         }
         Map<String,Object> x=new LinkedHashMap<>();x.put("type",eventType);x.put("tick",eventTick);x.put("steamid",eventSteamid);x.put("player",rs.getString(4));x.put("data",eventData);events.add(x);
       }}
      int finalScoreT=0,finalScoreCt=0,scoreTeam2=0,scoreTeam3=0;
      List<Map<String,Object>> scoreTimeline=new ArrayList<>();
      for(int i=0;i<totalRounds;i++){
        int side="T".equals(winners.get(i))?2:3;
        int team=sidesDifferFromFinal(i+1,totalRounds)?oppositeSide(side):side;
        if(ends.get(i)<=tick){
          if(side==2)finalScoreT++;else finalScoreCt++;
          if(team==2)scoreTeam2++;else scoreTeam3++;
        }
        scoreTimeline.add(Map.of("tick",ends.get(i),"team",team,"side",side));
      }
      out.put("scoreTimeline",scoreTimeline);
      out.put("team2Side",sidesDifferFromFinal(roundNumber,totalRounds)?3:2);
      out.put("scoreT",finalScoreT);out.put("scoreCt",finalScoreCt);out.put("scoreTeam2",scoreTeam2);out.put("scoreTeam3",scoreTeam3);
      out.put("matchId",id);out.put("roundNumber",roundNumber);out.put("startTick",start);out.put("freezeEndTick",freezeEnd);
      out.put("endTick",playbackEnd);out.put("roundEndTick",end);out.put("globalTick",tick);out.put("tickRate",64);out.put("players",players);out.put("events",events);
      out.put("roundCount",totalRounds);
      if(replayCache.size()>4096)replayCache.clear();
      replayCache.put(replayKey,out);
    } return out;
  }

  public synchronized Map<String,Object> startPovExport(Map<String,Object> task) throws Exception {
    Object match=task.get("matchId"), round=task.get("round"), start=task.get("startTick"), end=task.get("endTick"), players=task.get("players");
    if(match==null||round==null||start==null||end==null||!(players instanceof List<?>)||((List<?>)players).isEmpty()) throw new IllegalArgumentException("需要选择至少一个玩家和一个回合");
    long matchId=Long.parseLong(String.valueOf(match)),roundNumber=Long.parseLong(String.valueOf(round));
    Set<String> ready=new HashSet<>();
    for(Map<String,Object> recording:povExports(matchId))if(((Number)recording.get("round")).longValue()==roundNumber) {
      List<?> identities=recording.get("players") instanceof List<?> list?list:List.of();
      for(Object raw:(List<?>)recording.get("files")) {
        String name=String.valueOf(((Map<?,?>)raw).get("name"));int index=-1;
        if(name.matches("player_[0-9]{1,3}"))index=Integer.parseInt(name.substring(7));
        else if(identities.size()==1&&name.equals("final.mp4"))index=0;
        if(index>=0&&index<identities.size()&&identities.get(index) instanceof Map<?,?> identity)ready.add(String.valueOf(identity.get("steamid")));
      }
    }
    List<?> requested=(List<?>)players;
    if(!Boolean.TRUE.equals(task.get("force")))requested=requested.stream().filter(player->player instanceof Map<?,?> identity&&!ready.contains(String.valueOf(identity.get("steamid")))).toList();
    if(requested.isEmpty())return Map.of("status","completed","message","所选 POV 已生成，无需重复录制");
    Set<String> selected=new HashSet<>();for(Object player:requested)selected.add(String.valueOf(((Map<?,?>)player).get("steamid")));
    for(Map<String,Object> existing:povJobs.values())if(Set.of("queued","recording").contains(existing.get("status"))&&Objects.equals(existing.get("matchId"),matchId)&&Objects.equals(existing.get("round"),roundNumber)) {
      if(existing.get("players") instanceof List<?> identities&&identities.stream().anyMatch(player->player instanceof Map<?,?> identity&&selected.contains(String.valueOf(identity.get("steamid")))))throw new ResponseStatusException(HttpStatus.CONFLICT,"所选玩家的 POV 正在录制，请等待完成");
    }
    String demo=null;
    try(Connection c=databaseRepository.connection(); PreparedStatement ps=c.prepareStatement("SELECT demo_file_path FROM matches WHERE id=?")){ps.setLong(1,Long.parseLong(String.valueOf(match)));try(ResultSet rs=ps.executeQuery()){if(rs.next())demo=rs.getString(1);}}
    if(demo==null||demo.isBlank()||!Files.isRegularFile(Path.of(demo))) throw new IllegalStateException("找不到该比赛的 Demo 文件，请重新上传 Demo 后再导出");
    final String demoPath=demo;
    // Resolve the capture boundary from phase events, including old saved
    // favorites which do not contain next-round metadata.
    long requestedEnd=Long.parseLong(String.valueOf(end));
    long captureStart=Long.parseLong(String.valueOf(start));
    long roundEnd=requestedEnd;
    // The replay page sends its playback boundary, which may already be the
    // next round's prestart. Resolve the actual selected round_end first.
    try(Connection c=databaseRepository.connection(); PreparedStatement ps=c.prepareStatement("SELECT MAX(tick) FROM events WHERE match_id=? AND event_name='round_end' AND tick<=? AND tick>=? AND JSON_EXTRACT(data_json,'$.winner') IN ('T','CT')")){
      ps.setLong(1,Long.parseLong(String.valueOf(match)));ps.setLong(2,requestedEnd);ps.setLong(3,captureStart);
      try(ResultSet rs=ps.executeQuery()){if(rs.next()&&rs.getObject(1)!=null)roundEnd=rs.getLong(1);}
    }
    long captureEnd=roundEnd;
    // Match replay's transition boundary so POV includes the post-round
    // pickup window even when an ESL Demo has no round_prestart event.
    try(Connection c=databaseRepository.connection(); PreparedStatement ps=c.prepareStatement("SELECT MIN(tick) FROM events WHERE match_id=? AND event_name IN ('round_officially_ended','round_prestart') AND tick>? AND COALESCE(is_warmup,0)=0")){
      ps.setLong(1,Long.parseLong(String.valueOf(match)));ps.setLong(2,roundEnd);
      try(ResultSet rs=ps.executeQuery()){if(rs.next()&&rs.getObject(1)!=null)captureEnd=rs.getLong(1);}
    }
    Map<String,Object> exportTask=new LinkedHashMap<>(task);
    exportTask.put("players",requested);
    exportTask.put("captureEndTick",captureEnd);
    exportTask.put("start_tick",captureStart);
    // The replay UI keeps the transition boundary so the timeline and POV
    // include the selected round's post-win pickup window. Stop before the
    // next round's freeze phase so buy-time/loading frames are not appended.
    exportTask.put("end_tick",captureEnd);
    Path taskFile=Path.of(System.getProperty("user.dir"),".cache","pov-task-"+System.nanoTime()+".json");Files.createDirectories(taskFile.getParent());Files.writeString(taskFile,objectMapper.writeValueAsString(exportTask),StandardCharsets.UTF_8);
    Path out=Path.of(System.getProperty("user.dir"),"pov-output",String.valueOf(match),"round-"+round+"-"+System.nanoTime());Files.createDirectories(out);
    String jobId=UUID.randomUUID().toString();
    Map<String,Object> job=new ConcurrentHashMap<>(); job.put("jobId",jobId); job.put("matchId",matchId);job.put("round",roundNumber);job.put("players",requested);job.put("status","queued"); job.put("output",out.toString()); job.put("createdAt",System.currentTimeMillis()); povJobs.put(jobId,job);
    Path script=Path.of(System.getenv().getOrDefault("CS2_PROJECT_ROOT",Path.of(System.getProperty("user.dir")).toAbsolutePath().getParent().toString()),"tools","pov","export_single_pov.ps1");
    CompletableFuture.runAsync(()->{
      job.put("status","recording");
      try{
        ProcessBuilder pb=new ProcessBuilder(System.getenv().getOrDefault("CS2_POWERSHELL","powershell.exe"),"-ExecutionPolicy","Bypass","-File",script.toString(),"-Task",taskFile.toString(),"-Output",out.toString()); applyRecordingSettings(pb); pb.environment().put("CS2_DEMO",demoPath); pb.environment().put("POV_JOB_ID",jobId); pb.redirectErrorStream(true); pb.redirectOutput(out.resolve("render.log").toFile()); Process process=pb.start(); job.put("pid",process.pid()); int code=process.waitFor(); if(code!=0) throw new IllegalStateException(povFailure(out,code)); job.put("status","completed"); job.put("file",out.resolve("final.mp4").toString());
        job.put("fileUrl","/api/pov/export/"+jobId+"/file");
      }catch(Exception e){job.put("status","failed");job.put("message",Optional.ofNullable(e.getMessage()).orElse(e.toString()));}
      finally{try{Files.deleteIfExists(taskFile);}catch(IOException ignored){}}
    });
    return Map.of("status","queued","jobId",jobId,"output",out.toString());
  }

  String povFailure(Path out,int code) {
    try {
      Path report=out.resolve("worker-error.json");
      if(Files.isRegularFile(report)) {
        Map<?,?> error=objectMapper.readValue(report.toFile(),Map.class);
        if(error.get("message") instanceof String message&&!message.isBlank())return message;
      }
      Path log=out.resolve("render.log");
      if(Files.isRegularFile(log))try(RandomAccessFile file=new RandomAccessFile(log.toFile(),"r")) {
        int size=(int)Math.min(4096,file.length());byte[] tail=new byte[size];file.seek(file.length()-size);file.readFully(tail);
        String detail=new String(tail,StandardCharsets.UTF_8).trim();
        if(!detail.isBlank())return "POV 录制失败（退出码 "+code+"）："+detail+"。详细记录："+log;
      }
    }catch(IOException ignored){}
    return "POV 录制失败（退出码 "+code+"），未收到具体诊断；请检查设置页录制组件与任务 render.log。";
  }

  public Map<String,Object> povJob(String id){ Map<String,Object> job=povJobs.get(id); if(job==null) throw new ResponseStatusException(HttpStatus.NOT_FOUND,"POV 任务不存在"); return Map.copyOf(job); }
  public void deletePovExport(String id) throws IOException {
    Map<String,Object> job=povJobs.remove(id); if(job==null) throw new ResponseStatusException(HttpStatus.NOT_FOUND,"POV 任务不存在");
    Path output=Path.of(String.valueOf(job.get("output"))).toAbsolutePath().normalize();
    if(Files.isDirectory(output)) try(var paths=Files.walk(output)){paths.sorted(Comparator.reverseOrder()).forEach(p->{try{Files.deleteIfExists(p);}catch(IOException e){throw new UncheckedIOException(e);}});}
  }

  public List<Map<String,Object>> povExports(long matchId) throws IOException {
    Path root=Path.of(System.getProperty("user.dir"),"pov-output",String.valueOf(matchId));
    if(!Files.isDirectory(root)) return List.of();
    List<Map<String,Object>> result=new ArrayList<>();
    try(var dirs=Files.list(root)) {
      for(Path dir: (Iterable<Path>)dirs::iterator) {
        Path file=dir.resolve("final.mp4"); if(!Files.isRegularFile(file)||Files.size(file)<=0) continue;
        String name=dir.getFileName().toString(); String round="0";
        if(name.startsWith("round-")){int dash=name.indexOf('-',6); round=dash>0?name.substring(6,dash):name.substring(6);}
        String id="stored-"+Integer.toHexString(dir.toString().hashCode());
        Map<String,Object> job=new ConcurrentHashMap<>(); job.put("jobId",id);job.put("matchId",matchId);job.put("round",Integer.parseInt(round));job.put("status","completed");job.put("output",dir.toString());job.put("fileUrl","/api/pov/export/"+id+"/file");job.put("createdAt",Files.getLastModifiedTime(file).toMillis());
        Path worker=dir.resolve("hlae-worker.json"); if(Files.isRegularFile(worker)){try{Map<?,?> metadata=objectMapper.readValue(worker.toFile(),Map.class);if(metadata.get("players") instanceof List<?> players)job.put("players",players);}catch(Exception ignored){}}
        List<Map<String,Object>> files=new ArrayList<>(); Path players=dir.resolve("players"); if(Files.isDirectory(players)) try(var ps=Files.list(players)){for(Path pd:(Iterable<Path>)ps::iterator){Path pf=pd.resolve("final.mp4");if(Files.isRegularFile(pf)&&Files.size(pf)>0){Map<String,Object> f=new LinkedHashMap<>();f.put("name",pd.getFileName().toString());f.put("url","/api/pov/export/"+id+"/player/"+pd.getFileName().toString().replace("player_",""));files.add(f);}}} if(files.isEmpty()){Map<String,Object> f=new LinkedHashMap<>();f.put("name","final.mp4");f.put("url","/api/pov/export/"+id+"/file");files.add(f);} job.put("files",files);povJobs.put(id,job);result.add(Map.copyOf(job));
      }
    }
    return result;
  }

  public byte[] povFile(String id) throws IOException {
    Map<String,Object> job=povJobs.get(id); if(job==null) throw new ResponseStatusException(HttpStatus.NOT_FOUND,"POV 任务不存在");
    Path file=Path.of(String.valueOf(job.get("output"))).resolve("final.mp4").normalize();
    if(!Files.isRegularFile(file)) throw new ResponseStatusException(HttpStatus.NOT_FOUND,"视频尚未生成");
    return Files.readAllBytes(file);
  }
  public Path povFilePath(String id) throws IOException { Map<String,Object> job=povJobs.get(id); if(job==null) throw new ResponseStatusException(HttpStatus.NOT_FOUND,"POV 任务不存在"); Path file=Path.of(String.valueOf(job.get("output"))).resolve("final.mp4").normalize(); if(!Files.isRegularFile(file)) throw new ResponseStatusException(HttpStatus.NOT_FOUND,"视频尚未生成"); return file; }
  public Path povPlayerFilePath(String id,String player) throws IOException { Map<String,Object> job=povJobs.get(id); if(job==null) throw new ResponseStatusException(HttpStatus.NOT_FOUND,"POV 任务不存在"); Path file=Path.of(String.valueOf(job.get("output"))).resolve("players").resolve("player_"+player).resolve("final.mp4"); if(!Files.isRegularFile(file)) throw new ResponseStatusException(HttpStatus.NOT_FOUND,"玩家视频不存在"); return file; }
  public byte[] povPlayerFile(String id, String player) throws IOException { Map<String,Object> job=povJobs.get(id); if(job==null) throw new ResponseStatusException(HttpStatus.NOT_FOUND,"POV 任务不存在"); Path file=Path.of(String.valueOf(job.get("output"))).resolve("players").resolve("player_"+player).resolve("final.mp4"); if(!Files.isRegularFile(file)) throw new ResponseStatusException(HttpStatus.NOT_FOUND,"玩家视频不存在"); return Files.readAllBytes(file); }

  private String normalizedWeaponSql(String alias){
    return "normalized_weapon("+alias+".weapon)";
  }
}


