package com.csdemo.repository;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Repository;
import java.io.*;
import java.sql.*;
import java.util.*;

/** Only these tables and columns may cross the portable match boundary. */
@Repository
public class MatchPackageRepository {
  private final DatabaseRepository database;
  private final ObjectMapper json = new ObjectMapper();
  public static final LinkedHashMap<String,List<String>> TABLES = new LinkedHashMap<>();
  static {
    TABLES.put("matches", List.of("id","demo_file_path","map_name","patch_version","server_name","final_score_t","final_score_ct","warmup_end_tick","official_start_tick","recorded_at","recording_time_source","demo_sha256","imported_at"));
    TABLES.put("players", List.of("steamid","name"));
    TABLES.put("match_players", List.of("match_id","steamid","team_number","total_damage","display_name"));
    TABLES.put("rounds", List.of("id","match_id","tick","start_type","end_tick","round_number","data_json"));
    TABLES.put("events", List.of("id","match_id","round_id","event_name","tick","player_steamid","player_name","team_number","is_warmup","data_json"));
    TABLES.put("kills", List.of("id","match_id","round_id","tick","attacker_steamid","attacker_name","victim_steamid","victim_name","weapon","headshot","data_json"));
    TABLES.put("damages", List.of("id","match_id","round_id","tick","attacker_steamid","attacker_name","victim_steamid","victim_name","health_damage","armor_damage","data_json"));
    TABLES.put("bomb_events", List.of("id","match_id","round_id","tick","event_name","player_steamid","player_name","site","data_json"));
    TABLES.put("player_positions", List.of("id","match_id","tick","steamid","x","y","z","yaw","health","armor","alive","team_number","money","weapon","inventory"));
  }
  public MatchPackageRepository(DatabaseRepository database) { this.database=database; }

  private List<String> columns(Connection c,String table) throws SQLException {
    List<String> available=new ArrayList<>();
    try(PreparedStatement ps=c.prepareStatement("SELECT * FROM "+table+" WHERE 1=0");ResultSet rs=ps.executeQuery()) {
      for(int i=1;i<=rs.getMetaData().getColumnCount();i++) available.add(rs.getMetaData().getColumnName(i).toLowerCase(Locale.ROOT));
    }
    return TABLES.get(table).stream().filter(available::contains).toList();
  }

  public Map<String,Long> exportRows(long id,OutputStream output) throws SQLException,IOException {
    Map<String,Long> counts=new LinkedHashMap<>();
    try(Connection c=database.connection()) {
      c.setAutoCommit(false);c.setTransactionIsolation(Connection.TRANSACTION_SERIALIZABLE);
      for(String table:TABLES.keySet()) {
        List<String> fields=columns(c,table);
        String prefix=table.equals("players")?"p.":"";
        String query="SELECT "+String.join(",",fields.stream().map(s->prefix+s).toList())+" FROM "+table;
        if(table.equals("players")) query="SELECT "+String.join(",",fields.stream().map(s->"p."+s).toList())+" FROM players p JOIN match_players mp ON mp.steamid=p.steamid WHERE mp.match_id=? ORDER BY p.steamid";
        else query+=" WHERE "+(table.equals("matches")?"id":"match_id")+"=? ORDER BY "+(fields.contains("id")?"id":"steamid");
        long count=0;
        try(PreparedStatement ps=c.prepareStatement(query,ResultSet.TYPE_FORWARD_ONLY,ResultSet.CONCUR_READ_ONLY)) {
          if(c.getMetaData().getDatabaseProductName().equalsIgnoreCase("MySQL")) ps.setFetchSize(Integer.MIN_VALUE);
          ps.setLong(1,id);
          try(ResultSet rs=ps.executeQuery()) {
            while(rs.next()) {
              Map<String,Object> row=new LinkedHashMap<>();
              for(int i=0;i<fields.size();i++) {
                Object value=rs.getObject(i+1);
                if(value instanceof java.util.Date||value instanceof java.time.temporal.TemporalAccessor) value=rs.getString(i+1);
                if(table.equals("matches")&&fields.get(i).equals("demo_file_path")&&value!=null) value=String.valueOf(value).replace('\\','/').replaceAll("^.*/","");
                row.put(fields.get(i),value);
              }
              output.write(json.writeValueAsBytes(Map.of("table",table,"values",row)));output.write('\n');count++;
            }
          }
        }
        counts.put(table,count);
      }
      if(counts.get("matches")!=1) throw new IOException("比赛不存在");
      c.commit();
    }
    return counts;
  }

  public ImportSession beginImport() throws SQLException { return new ImportSession(database.bulkConnection()); }

  public final class ImportSession implements AutoCloseable {
    private final Connection c;
    private final Map<String,List<String>> available=new HashMap<>();
    private final Map<Long,Long> rounds=new HashMap<>();
    private PreparedStatement batch;
    private String batchSql="";
    private int batchCount;
    private boolean committed;
    public ImportSession(Connection c) throws SQLException {
      this.c=c;c.setAutoCommit(false);
      for(String table:TABLES.keySet()) available.put(table,columns(c,table));
    }
    public Long existing(String demoHash,String portablePath) throws SQLException {
      try(PreparedStatement ps=c.prepareStatement("SELECT id FROM matches WHERE demo_sha256=? OR demo_file_path=? ORDER BY id LIMIT 1")) {
        ps.setString(1,demoHash);ps.setString(2,portablePath);
        try(ResultSet rs=ps.executeQuery()) { return rs.next()?rs.getLong(1):null; }
      }
    }
    public long insert(String table,Map<String,Object> source,long sourceId,long matchId,String portablePath) throws SQLException,IOException {
      if(!TABLES.containsKey(table)||!TABLES.get(table).containsAll(source.keySet())) throw new IOException("比赛包包含未知数据库字段");
      if(!available.get(table).containsAll(source.keySet())) throw new IOException("数据库版本缺少比赛包字段，请先升级应用");
      Map<String,Object> row=new LinkedHashMap<>(source);
      if(!table.equals("players")&&!table.equals("matches")) {
        if(!(row.get("match_id") instanceof Number n)||n.longValue()!=sourceId) throw new IOException("比赛包跨比赛记录不合法");
        row.put("match_id",matchId);
      }
      long oldId=row.get("id") instanceof Number n?n.longValue():0;
      row.remove("id");
      if(table.equals("matches")) row.put("demo_file_path",portablePath);
      if(row.get("round_id")!=null) {
        Long mapped=rounds.get(((Number)row.get("round_id")).longValue());
        if(mapped==null) throw new IOException("比赛包回合引用不存在");
        row.put("round_id",mapped);
      }
      List<String> fields=new ArrayList<>(row.keySet());
      String sql="INSERT INTO "+table+" ("+String.join(",",fields)+") VALUES ("+String.join(",",Collections.nCopies(fields.size(),"?"))+")";
      if(table.equals("players")) sql+=" ON CONFLICT(steamid) DO NOTHING";
      if(table.equals("matches")||table.equals("rounds")) {
        flush();
        try(PreparedStatement ps=c.prepareStatement(sql,Statement.RETURN_GENERATED_KEYS)) {
          bind(ps,fields,row);ps.executeUpdate();
          try(ResultSet keys=ps.getGeneratedKeys()) {
            if(!keys.next()) throw new SQLException("无法生成比赛/回合 ID");
            long newId=keys.getLong(1);if(table.equals("rounds")) { if(rounds.putIfAbsent(oldId,newId)!=null)throw new IOException("比赛包包含重复回合 ID"); }return newId;
          }
        }
      }
      if(!sql.equals(batchSql)) { flush();if(batch!=null)batch.close();batch=c.prepareStatement(sql);batchSql=sql; }
      bind(batch,fields,row);batch.addBatch();if(++batchCount>=1000)flush();return matchId;
    }
    private void bind(PreparedStatement ps,List<String> fields,Map<String,Object> row) throws SQLException {
      for(int i=0;i<fields.size();i++) ps.setObject(i+1,row.get(fields.get(i)));
    }
    private void flush() throws SQLException { if(batchCount>0) { batch.executeBatch();batchCount=0; } }
    public void commit() throws SQLException { flush();c.commit();committed=true; }
    public void close() throws SQLException {
      try { if(!committed)c.rollback(); } finally { try { if(batch!=null)batch.close(); } finally { c.close(); } }
    }
  }
}
