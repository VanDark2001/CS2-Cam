package com.csdemo.service;

import com.csdemo.repository.MatchPackageRepository;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.*;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;
import jakarta.annotation.PreDestroy;
import java.io.*;
import java.nio.file.*;
import java.security.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.zip.*;

/** Portable snapshots contain data and media, never executable SQL or local configuration. */
@Service
public class MatchPackageService {
  static final long MAX_BYTES=8L*1024*1024*1024;
  private static final int MAX_ENTRIES=2048;
  private final MatchPackageRepository repository;
  private final DemoService demos;
  private final ObjectMapper json=new ObjectMapper();
  private final Path root=Path.of(System.getProperty("user.dir")).toAbsolutePath().normalize();
  private final Map<String,Map<String,Object>> jobs=new ConcurrentHashMap<>();
  private final Semaphore capacity=new Semaphore(2);
  private final ExecutorService worker=Executors.newSingleThreadExecutor(r->{Thread t=new Thread(r,"match-package");t.setDaemon(true);return t;});
  public MatchPackageService(MatchPackageRepository repository,DemoService demos) { this.repository=repository;this.demos=demos; }
  @PreDestroy public void close() { worker.shutdownNow(); }
  public long activeJobs(){return jobs.values().stream().filter(job->!Set.of("completed","failed").contains(String.valueOf(job.get("status")))).count();}

  private Map<String,Object> newJob(String kind) throws IOException {
    if(!capacity.tryAcquire())throw new ResponseStatusException(HttpStatus.CONFLICT,"已有比赛包任务，请等待完成");
    try {
      purge();String id=UUID.randomUUID().toString();Files.createDirectories(jobDir(id));
      Map<String,Object> job=new ConcurrentHashMap<>();job.put("jobId",id);job.put("kind",kind);job.put("status","queued");job.put("message","等待处理");job.put("createdAt",System.currentTimeMillis());jobs.put(id,job);return job;
    } catch(IOException e) { capacity.release();throw e; }
  }
  private Path jobDir(String id) { return root.resolve(".cache/match-packages").resolve(id); }
  private void purge() throws IOException {
    Path cache=root.resolve(".cache/match-packages");if(!Files.isDirectory(cache))return;
    long cutoff=System.currentTimeMillis()-24*60*60*1000L;
    try(var dirs=Files.list(cache)) {
      for(Path dir:dirs.toList()) if(dir.getFileName().toString().matches("[0-9a-f-]{36}")&&Files.getLastModifiedTime(dir).toMillis()<cutoff) {
        Map<String,Object> job=jobs.get(dir.getFileName().toString());
        if(job==null||Set.of("completed","failed").contains(job.get("status"))) { deleteOwned(dir,cache);jobs.remove(dir.getFileName().toString()); }
      }
    }
  }
  public Map<String,Object> status(String id) {
    Map<String,Object> job=jobs.get(id);if(job==null)throw new ResponseStatusException(HttpStatus.NOT_FOUND,"比赛包任务不存在或已过期");return Map.copyOf(job);
  }
  public Path download(String id) {
    Map<String,Object> job=status(id);
    if(!job.get("kind").equals("export")||!job.get("status").equals("completed"))throw new ResponseStatusException(HttpStatus.CONFLICT,"比赛包尚未准备好");
    return jobDir(id).resolve("match.csdemo");
  }
  public Map<String,Object> exportMatch(long id,List<Map<String,Object>> favorites) throws Exception {
    return exportMatch(id,favorites,"match");
  }
  public Map<String,Object> exportMatch(long id,List<Map<String,Object>> favorites,String scope) throws Exception {
    if(!Set.of("match","favorites").contains(scope))throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"导出范围不合法");
    Map<String,Object> match=demos.detail(id);
    if(favorites.size()>100)throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"收藏条目过多");
    List<Map<String,Object>> selected=new ArrayList<>();
    for(Map<String,Object> favorite:favorites)if(number(favorite.get("matchId"))==id) {
      cleanPlayers(list(favorite.get("players")));selected.add(new LinkedHashMap<>(favorite));
    }
    if(scope.equals("favorites")&&selected.isEmpty())throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"本场比赛没有可导出的收藏");
    Map<String,Object> job=newJob("export");String jobId=(String)job.get("jobId");
    run(job,()->build(id,match,selected,scope,jobDir(jobId),job));return Map.copyOf(job);
  }
  public Map<String,Object> importMatch(MultipartFile file) throws IOException {
    if(file.isEmpty()||file.getSize()>MAX_BYTES||file.getOriginalFilename()==null||!file.getOriginalFilename().toLowerCase(Locale.ROOT).endsWith(".csdemo"))throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"请选择 8GB 以内的 .csdemo 比赛包");
    Map<String,Object> job=newJob("import");Path dir=jobDir((String)job.get("jobId"));
    try(InputStream input=file.getInputStream()) { Files.copy(input,dir.resolve("upload.csdemo")); }
    catch(IOException e) { capacity.release();job.put("status","failed");throw e; }
    run(job,()->restore(dir,job));return Map.copyOf(job);
  }
  @FunctionalInterface private interface Work { void execute() throws Exception; }
  private void run(Map<String,Object> job,Work work) {
    worker.submit(()->{
      job.put("status","working");
      try { work.execute();job.put("status","completed"); }
      catch(Exception e) { job.put("status","failed");job.put("message",Optional.ofNullable(e.getMessage()).orElse("比赛包处理失败")); }
      finally { capacity.release(); }
    });
  }
  private void phase(Map<String,Object> job,String text) { job.put("message",text); }
  private Map<String,Object> fileInfo(String name,Path file) throws Exception { return Map.of("path",name,"size",Files.size(file),"sha256",sha(file)); }
  static String sha(Path file) throws IOException {
    try {
      MessageDigest digest=MessageDigest.getInstance("SHA-256");
      try(InputStream input=new DigestInputStream(Files.newInputStream(file),digest)) { input.transferTo(OutputStream.nullOutputStream()); }
      return HexFormat.of().formatHex(digest.digest());
    } catch(NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
  }
  private void build(long id,Map<String,Object> match,List<Map<String,Object>> favorites,String scope,Path dir,Map<String,Object> job) throws Exception {
    phase(job,"正在打包比赛数据");Path data=dir.resolve("data.ndjson");Map<String,Long> counts;
    try(OutputStream output=new BufferedOutputStream(Files.newOutputStream(data))) { counts=repository.exportRows(id,output); }
    Map<String,Path> files=new LinkedHashMap<>();files.put("data.ndjson",data);
    // A full-match package must remain replayable on another machine. Include
    // the original Demo from the app-owned uploads directory; favorites-only
    // packages stay lightweight and intentionally contain only selected POVs.
    boolean demoIncluded=false;
    if(scope.equals("match")) {
      Object rawDemo=match.get("file");
      if(rawDemo instanceof String text&&!text.isBlank()) {
        Path uploads=root.getParent().resolve("uploads").toAbsolutePath().normalize();
        Path sourceDemo=Path.of(text).toAbsolutePath().normalize();
        if(sourceDemo.startsWith(uploads)&&Files.isRegularFile(sourceDemo)) { files.put("demo/source.dem",sourceDemo);demoIncluded=true; }
      }
    }
    job.put("demoIncluded",demoIncluded);
    Set<String> wanted=new HashSet<>(),included=new HashSet<>();
    for(Map<String,Object> favorite:favorites)for(Map<String,Object> player:cleanPlayers(list(favorite.get("players"))))wanted.add(number(favorite.get("round"))+":"+player.get("steamid"));
    List<Map<String,Object>> povs=new ArrayList<>();int index=0,viewCount=0;
    List<Map<String,Object>> recordings=new ArrayList<>(demos.povExports(id));
    recordings.sort(Comparator.comparingLong((Map<String,Object> p)->((Number)p.getOrDefault("createdAt",0)).longValue()).reversed());
    for(Map<String,Object> pov:recordings) {
      Path source=Path.of(String.valueOf(pov.get("output"))).toAbsolutePath().normalize();
      if(!source.startsWith(root.resolve("pov-output").resolve(String.valueOf(id)))||Files.isSymbolicLink(source))throw new IOException("POV 路径不合法");
      String key=String.valueOf(index);long round=number(pov.get("round"));
      List<Map<String,Object>> players=cleanPlayers(list(pov.getOrDefault("players",List.of())));
      if(scope.equals("favorites")) {
        List<Map<String,Object>> chosen=new ArrayList<>();Path first=null;
        for(int slot=0;slot<players.size();slot++) {
          Map<String,Object> player=players.get(slot);String identity=round+":"+player.get("steamid");
          if(!wanted.contains(identity)||included.contains(identity))continue;
          Path video=source.resolve("players/player_"+slot+"/final.mp4");
          if(!Files.isRegularFile(video)&&players.size()==1)video=source.resolve("final.mp4");
          if(!Files.isRegularFile(video)||Files.size(video)<=0)continue;
          files.put("pov/"+key+"/players/player_"+chosen.size()+"/final.mp4",video);
          chosen.add(player);included.add(identity);if(first==null)first=video;
        }
        if(chosen.isEmpty())continue;
        files.put("pov/"+key+"/final.mp4",first);players=chosen;viewCount+=chosen.size();
      } else {
        files.put("pov/"+key+"/final.mp4",source.resolve("final.mp4"));
        List<Path> videos=videoFiles(source);
        for(Path video:videos)if(!video.equals(source.resolve("final.mp4")))files.put("pov/"+key+"/"+source.relativize(video).toString().replace('\\','/'),video);
        viewCount+=Math.max(1,videos.size()-1);
      }
      povs.add(Map.of("key",key,"round",round,"players",players));index++;
    }
    phase(job,"正在校验媒体文件");List<Map<String,Object>> inventory=new ArrayList<>();long total=0;
    for(var file:files.entrySet()) {
      if(Files.isSymbolicLink(file.getValue()))throw new IOException("不打包符号链接");
      total+=Files.size(file.getValue());if(total>MAX_BYTES)throw new IOException("比赛包解压总量超过 8GB，请减少本场录制文件后重试");
      inventory.add(fileInfo(file.getKey(),file.getValue()));
    }
    List<Map<String,Object>> portableFavorites=new ArrayList<>();
    for(Map<String,Object> favorite:favorites) if(number(favorite.get("matchId"))==id) {
      Map<String,Object> clean=new LinkedHashMap<>();
      for(String field:List.of("round","startTick","endTick","players","title","note","createdAt"))if(favorite.containsKey(field))clean.put(field,favorite.get(field));
      portableFavorites.add(clean);
    }
    Map<String,Object> metadata=new LinkedHashMap<>();metadata.put("sourceId",id);metadata.put("map",match.get("map"));metadata.put("date",match.get("date"));metadata.put("dateSource",match.get("dateSource"));
    Map<String,Object> manifest=new LinkedHashMap<>();manifest.put("format","cs2-demo-show");manifest.put("version",1);manifest.put("scope",scope);manifest.put("match",metadata);manifest.put("rows",counts);manifest.put("files",inventory);manifest.put("povs",povs);manifest.put("favorites",portableFavorites);
    byte[] manifestBytes=json.writeValueAsBytes(manifest);if(manifestBytes.length>4*1024*1024)throw new IOException("收藏元数据过大");
    phase(job,"正在压缩比赛包");
    try(ZipOutputStream zip=new ZipOutputStream(new BufferedOutputStream(Files.newOutputStream(dir.resolve("match.csdemo"))))) {
      zip.setLevel(1);zip.putNextEntry(new ZipEntry("manifest.json"));zip.write(manifestBytes);zip.closeEntry();
      for(var file:files.entrySet()) { zip.putNextEntry(new ZipEntry(file.getKey()));Files.copy(file.getValue(),zip);zip.closeEntry(); }
    }
    Files.delete(data);
    job.put("downloadUrl","/api/match-packages/jobs/"+job.get("jobId")+"/file");job.put("fileName",String.valueOf(match.get("map")).replaceAll("[^a-zA-Z0-9_-]","_")+"-"+scope+"-"+id+".csdemo");job.put("povCount",povs.size());job.put("viewCount",viewCount);job.put("missingViews",scope.equals("favorites")?wanted.size()-included.size():0);job.put("bytes",Files.size(dir.resolve("match.csdemo")));phase(job,demoIncluded||scope.equals("favorites")?"比赛包已就绪":"比赛包已就绪，但未找到原始 Demo");
  }

  static boolean safeEntry(String name) {
    return name.equals("data.ndjson")||name.equals("demo/source.dem")||name.matches("pov/[0-9]{1,3}/(?:final\\.mp4|players/player_[0-9]{1,3}/final\\.mp4)");
  }
  static long number(Object value) throws IOException {
    if(!(value instanceof Number n))throw new IOException("比赛包数值字段不合法");
    try { return new java.math.BigDecimal(n.toString()).longValueExact(); } catch(ArithmeticException|NumberFormatException e) { throw new IOException("比赛包整数不合法",e); }
  }
  @SuppressWarnings("unchecked") static Map<String,Object> object(Object value) throws IOException {
    if(!(value instanceof Map<?,?> map)||map.keySet().stream().anyMatch(key->!(key instanceof String)))throw new IOException("比赛包对象格式不合法");return (Map<String,Object>)map;
  }
  static List<?> list(Object value) throws IOException { if(!(value instanceof List<?> values))throw new IOException("比赛包列表格式不合法");return values; }
  private Map<String,Object> unpack(Path archive,Path dir) throws Exception {
    Files.createDirectories(dir);
    try(ZipFile zip=new ZipFile(archive.toFile())) {
      if(zip.size()>MAX_ENTRIES)throw new IOException("比赛包文件过多");
      ZipEntry entry=zip.getEntry("manifest.json");if(entry==null||entry.getSize()<0||entry.getSize()>4*1024*1024)throw new IOException("缺少有效的比赛包清单");
      Map<String,Object> manifest;
      try(InputStream input=zip.getInputStream(entry)) {
        byte[] bytes=input.readNBytes(4*1024*1024+1);if(bytes.length>4*1024*1024)throw new IOException("比赛包清单超限");
        manifest=json.readValue(bytes,new TypeReference<>(){});
      }
      if(!"cs2-demo-show".equals(manifest.get("format"))||number(manifest.get("version"))!=1)throw new IOException("不支持的比赛包格式版本");
      Map<String,Map<String,Object>> declared=new LinkedHashMap<>();long total=0;
      for(Object item:list(manifest.get("files"))) {
        Map<String,Object> info=object(item);String name=String.valueOf(info.get("path"));long size=number(info.get("size"));
        if(!safeEntry(name)||declared.putIfAbsent(name,info)!=null||size<0||size>MAX_BYTES||total>MAX_BYTES-size||!String.valueOf(info.get("sha256")).matches("[a-f0-9]{64}"))throw new IOException("比赛包路径、大小或摘要不合法");
        total+=size;
      }
      if(!declared.containsKey("data.ndjson"))throw new IOException("比赛包缺少数据库记录");
      Set<String> seen=new HashSet<>();Enumeration<? extends ZipEntry> entries=zip.entries();
      while(entries.hasMoreElements()) {
        ZipEntry file=entries.nextElement();String name=file.getName();
        if(!seen.add(name)||(!name.equals("manifest.json")&&!declared.containsKey(name))||file.isDirectory())throw new IOException("比赛包包含未声明或重复的文件");
        if(name.equals("manifest.json"))continue;
        long expected=number(declared.get(name).get("size"));if(file.getSize()!=expected)throw new IOException("比赛包文件大小不匹配");
        Path target=dir.resolve(name).normalize();if(!target.startsWith(dir))throw new IOException("比赛包路径越界");Files.createDirectories(target.getParent());
        try(InputStream input=zip.getInputStream(file);OutputStream output=Files.newOutputStream(target)) {
          byte[] buffer=new byte[128*1024];long copied=0;int length;
          while((length=input.read(buffer))!=-1) { copied+=length;if(copied>expected)throw new IOException("比赛包文件解压超限");output.write(buffer,0,length); }
          if(copied!=expected)throw new IOException("比赛包文件截断");
        }
        if(!sha(target).equals(declared.get(name).get("sha256")))throw new IOException("比赛包文件校验失败："+name);
      }
      if(seen.size()!=declared.size()+1)throw new IOException("比赛包缺少清单中的文件");return manifest;
    }
  }

  private void restore(Path dir,Map<String,Object> job) throws Exception {
    List<Path> installed=new ArrayList<>();boolean committed=false;Path unpacked=dir.resolve("unpacked");
    try {
      phase(job,"正在解压并校验比赛包");Map<String,Object> manifest=unpack(dir.resolve("upload.csdemo"),unpacked);
      Map<String,Object> metadata=object(manifest.get("match"));long sourceId=number(metadata.get("sourceId"));
      Map<String,Object> expected=object(manifest.get("rows"));if(!expected.keySet().equals(MatchPackageRepository.TABLES.keySet()))throw new IOException("比赛包表清单不完整");
      long total=0;for(Object count:expected.values()) { long n=number(count);if(n<0||n>5_000_000||total>10_000_000-n)throw new IOException("比赛包记录数超限");total+=n; }
      if(number(expected.get("matches"))!=1||number(expected.get("match_players"))<1||number(expected.get("players"))<1)throw new IOException("比赛包缺少比赛阵容");
      String fingerprint=sha(unpacked.resolve("data.ndjson"));
      Path demoTarget=root.getParent().resolve("uploads").resolve("portable-"+fingerprint+".dem");
      Map<String,Long> actual=new LinkedHashMap<>();for(String table:MatchPackageRepository.TABLES.keySet())actual.put(table,0L);
      List<String> order=new ArrayList<>(MatchPackageRepository.TABLES.keySet());int previous=-1;long matchId=0;boolean duplicate=false;
      phase(job,"正在导入比赛记录");
      try(MatchPackageRepository.ImportSession session=repository.beginImport();InputStream input=Files.newInputStream(unpacked.resolve("data.ndjson"));MappingIterator<Map<String,Object>> records=json.readerFor(new TypeReference<Map<String,Object>>(){}).readValues(input)) {
        while(records.hasNextValue()) {
          Map<String,Object> record=records.nextValue();String table=String.valueOf(record.get("table"));int index=order.indexOf(table);
          if(index<0||index<previous)throw new IOException("比赛包记录顺序不合法");previous=index;
          Map<String,Object> row=object(record.get("values"));
          if(!MatchPackageRepository.TABLES.get(table).containsAll(row.keySet())||row.values().stream().anyMatch(v->v instanceof Map||v instanceof List))throw new IOException("比赛包记录字段不合法");
          long count=actual.merge(table,1L,Long::sum);if(count>number(expected.get(table)))throw new IOException("比赛包记录数量不匹配");
          if(table.equals("matches")) {
            if(number(row.get("id"))!=sourceId)throw new IOException("比赛包比赛 ID 不匹配");
            String demoHash=row.get("demo_sha256")==null?null:String.valueOf(row.get("demo_sha256"));
            if(demoHash!=null&&!demoHash.matches("[a-f0-9]{64}"))throw new IOException("Demo 指纹不合法");
            Long existing=session.existing(demoHash,demoTarget.toString());duplicate=existing!=null;
            matchId=duplicate?existing:session.insert(table,row,sourceId,0,demoTarget.toString());
          } else {
            if(matchId<=0)throw new IOException("比赛包缺少比赛主记录");
            if(!table.equals("players")&&number(row.get("match_id"))!=sourceId)throw new IOException("比赛包跨比赛记录不合法");
            if(!duplicate)session.insert(table,row,sourceId,matchId,demoTarget.toString());
          }
          if(count%5000==0)phase(job,"正在导入 "+table+" · "+count+" 条记录");
        }
        for(String table:order)if(actual.get(table)!=number(expected.get(table)))throw new IOException("比赛包记录数量不匹配："+table);
        List<Map<String,Object>> favorites=importFavorites(manifest,metadata,matchId);
        phase(job,"正在安装 POV 文件");installPovs(manifest,unpacked,matchId,installed);
        Path sourceDemo=unpacked.resolve("demo/source.dem");
        if(!duplicate&&Files.isRegularFile(sourceDemo)) {
          Files.createDirectories(demoTarget.getParent());if(!Files.exists(demoTarget)) { Files.move(sourceDemo,demoTarget);installed.add(demoTarget); }
        }
        session.commit();committed=true;demos.invalidateAfterPackageImport();
        job.put("matchId",matchId);job.put("duplicate",duplicate);job.put("favorites",favorites);job.put("povCount",list(manifest.get("povs")).size());phase(job,duplicate?"已识别已有比赛，POV 与收藏已合并":"比赛包导入完成");
      }
    } finally {
      if(!committed)for(Path file:installed)deleteOwned(file,file.startsWith(root.resolve("pov-output"))?root.resolve("pov-output"):root.getParent().resolve("uploads"));
      deleteOwned(unpacked,dir);Files.deleteIfExists(dir.resolve("upload.csdemo"));
    }
  }
  private List<Map<String,Object>> importFavorites(Map<String,Object> manifest,Map<String,Object> metadata,long matchId) throws IOException {
    List<?> rows=list(manifest.get("favorites"));if(rows.size()>100)throw new IOException("比赛包收藏过多");List<Map<String,Object>> out=new ArrayList<>();
    for(Object raw:rows) {
      Map<String,Object> source=object(raw);long round=number(source.get("round"));if(round<1||round>1000)throw new IOException("收藏回合不合法");
      List<?> players=list(source.get("players"));if(players.isEmpty()||players.size()>20)throw new IOException("收藏玩家不合法");
      List<Map<String,Object>> cleanPlayers=cleanPlayers(players);
      Map<String,Object> clean=new LinkedHashMap<>();clean.put("id",UUID.randomUUID().toString());clean.put("matchId",matchId);clean.put("map",metadata.get("map"));clean.put("matchDate",metadata.get("date"));clean.put("dateSource",metadata.get("dateSource"));clean.put("round",round);clean.put("players",cleanPlayers);
      for(String field:List.of("startTick","endTick"))if(source.containsKey(field))clean.put(field,number(source.get(field)));
      String note=String.valueOf(source.getOrDefault("note",""));if(note.length()>20_000)throw new IOException("收藏备注过长");clean.put("note",note);clean.put("createdAt",source.getOrDefault("createdAt",java.time.Instant.now().toString()));out.add(clean);
      String title=String.valueOf(source.getOrDefault("title",""));if(title.length()>200)throw new IOException("收藏名称过长");clean.put("title",title);
    }
    return out;
  }
  private List<Map<String,Object>> cleanPlayers(List<?> players) throws IOException {
    if(players.size()>20)throw new IOException("POV 玩家过多");List<Map<String,Object>> out=new ArrayList<>();
    for(Object item:players) {
      Map<String,Object> player=object(item);String steamid=String.valueOf(player.get("steamid")),name=String.valueOf(player.getOrDefault("name",steamid));
      if(!steamid.matches("[0-9]{17}")||name.length()>255)throw new IOException("POV 玩家身份不合法");
      Map<String,Object> clean=new LinkedHashMap<>();clean.put("steamid",steamid);clean.put("name",name);
      if(player.containsKey("slot")) { long slot=number(player.get("slot"));if(slot<0||slot>20)throw new IOException("POV 玩家索引不合法");clean.put("slot",slot); }out.add(clean);
    }
    return out;
  }
  private void installPovs(Map<String,Object> manifest,Path unpacked,long matchId,List<Path> installed) throws Exception {
    List<?> povs=list(manifest.get("povs"));if(povs.size()>200)throw new IOException("POV 任务过多");Set<String> keys=new HashSet<>();
    Set<String> existingVideos=new HashSet<>(),existingViews=new HashSet<>();
    for(Map<String,Object> existing:demos.povExports(matchId)) {
      Path output=Path.of(String.valueOf(existing.get("output")));
      long round=number(existing.get("round"));List<Map<String,Object>> players=cleanPlayers(list(existing.getOrDefault("players",List.of())));
      existingVideos.add(povIdentity(output,round,players));existingViews.addAll(viewIdentities(output,round,players));
    }
    for(Object raw:povs) {
      Map<String,Object> pov=object(raw);String key=String.valueOf(pov.get("key"));long round=number(pov.get("round"));
      if(!key.matches("[0-9]{1,3}")||!keys.add(key)||round<1||round>1000)throw new IOException("POV 任务不合法");
      List<Map<String,Object>> players=cleanPlayers(list(pov.get("players")));Path source=unpacked.resolve("pov").resolve(key);
      if(!Files.isRegularFile(source.resolve("final.mp4")))throw new IOException("比赛包缺少 POV 主视频");
      String digest=povIdentity(source,round,players);
      if(existingVideos.contains(digest))continue;
      List<String> views=viewIdentities(source,round,players);
      if(!players.isEmpty()&&views.size()==players.size()) {
        List<Integer> missing=new ArrayList<>();for(int i=0;i<views.size();i++)if(!existingViews.contains(views.get(i)))missing.add(i);
        if(missing.isEmpty())continue;
        if(missing.size()<players.size()) {
          Path selected=unpacked.resolve("selected-pov").resolve(key);Files.createDirectories(selected);
          List<Map<String,Object>> chosen=new ArrayList<>();
          for(int slot:missing) {
            Path video=source.resolve("players/player_"+slot+"/final.mp4"),target=selected.resolve("players/player_"+chosen.size()+"/final.mp4");
            if(!Files.isRegularFile(video)&&players.size()==1)video=source.resolve("final.mp4");
            Files.createDirectories(target.getParent());Files.copy(video,target);if(chosen.isEmpty())Files.copy(video,selected.resolve("final.mp4"));chosen.add(players.get(slot));
          }
          source=selected;players=chosen;digest=povIdentity(source,round,players);
        }
      }
      List<Path> videoFiles=videoFiles(source);
      Path target=root.resolve("pov-output").resolve(String.valueOf(matchId)).resolve("round-"+round+"-import-"+digest.substring(0,24));
      if(Files.exists(target)) {
        for(Path video:videoFiles) { Path existing=target.resolve(source.relativize(video));if(!Files.isRegularFile(existing)||!sha(existing).equals(sha(video)))throw new IOException("已有导入视频不完整，未覆盖本地文件"); }
        continue;
      }
      json.writeValue(source.resolve("hlae-worker.json").toFile(),Map.of("players",players,"round",round,"matchId",matchId));
      Files.createDirectories(target.getParent());Files.move(source,target);installed.add(target);
      existingVideos.add(digest);existingViews.addAll(viewIdentities(target,round,players));
    }
    Path povRoot=unpacked.resolve("pov");if(Files.isDirectory(povRoot))try(var paths=Files.list(povRoot)) {
      for(Path path:paths.toList())if(!keys.contains(path.getFileName().toString()))throw new IOException("比赛包包含未关联 POV");
    }
  }
  private List<String> viewIdentities(Path source,long round,List<Map<String,Object>> players) throws Exception {
    List<String> identities=new ArrayList<>();
    for(int slot=0;slot<players.size();slot++) {
      Path video=source.resolve("players/player_"+slot+"/final.mp4");if(!Files.isRegularFile(video)&&players.size()==1)video=source.resolve("final.mp4");
      if(!Files.isRegularFile(video))return List.of();
      identities.add(round+":"+players.get(slot).get("steamid")+":"+sha(video));
    }
    return identities;
  }
  private List<Path> videoFiles(Path source) throws IOException {
    List<Path> files=new ArrayList<>();files.add(source.resolve("final.mp4"));Path players=source.resolve("players");
    if(Files.isDirectory(players))try(var dirs=Files.list(players)) {
      for(Path player:dirs.sorted().toList())if(player.getFileName().toString().matches("player_[0-9]{1,3}")&&Files.isRegularFile(player.resolve("final.mp4")))files.add(player.resolve("final.mp4"));
    }
    return files;
  }
  private String povIdentity(Path source,long round,List<Map<String,Object>> players) throws Exception {
    Map<String,Object> metadata=new LinkedHashMap<>();metadata.put("round",round);metadata.put("players",players);
    StringBuilder identity=new StringBuilder(json.writeValueAsString(metadata));
    for(Path video:videoFiles(source))identity.append(source.relativize(video).toString().replace('\\','/')).append(sha(video));
    return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(identity.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8)));
  }
  static void deleteOwned(Path target,Path parent) throws IOException {
    Path resolved=target.toAbsolutePath().normalize(),boundary=parent.toAbsolutePath().normalize();
    if(resolved.equals(boundary)||!resolved.startsWith(boundary))throw new IOException("拒绝清理工作目录外文件");
    if(Files.isDirectory(resolved))try(var paths=Files.walk(resolved)) { for(Path path:paths.sorted(Comparator.reverseOrder()).toList())Files.deleteIfExists(path); }
    else Files.deleteIfExists(resolved);
  }
}
