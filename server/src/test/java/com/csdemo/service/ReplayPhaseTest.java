package com.csdemo.service;

import com.csdemo.repository.DatabaseRepository;
import org.junit.jupiter.api.Test;
import java.sql.*;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class ReplayPhaseTest {
  private Map<String,Object> replay(Long freezeEnd) throws Exception { return replay(freezeEnd,null); }
  private Map<String,Object> replay(Long freezeEnd, Long officialEnd) throws Exception {
    DatabaseRepository database=mock(DatabaseRepository.class);
    Connection connection=mock(Connection.class);
    when(database.connection()).thenReturn(connection);
    when(connection.prepareStatement(anyString())).thenAnswer(call -> {
      String sql=call.getArgument(0);
      PreparedStatement statement=mock(PreparedStatement.class);
      ResultSet rows=mock(ResultSet.class);
      when(statement.executeQuery()).thenReturn(rows);
      Long tick=null;
      boolean scalar=false;
      if(sql.startsWith("SELECT COALESCE(official_start_tick")) { tick=1182L;scalar=true; }
      else if(sql.startsWith("SELECT tick,MAX(")) {
        tick=4332L;scalar=true;when(rows.getString(2)).thenReturn("CT");
      } else if(sql.contains("event_name='round_freeze_end'")) { tick=freezeEnd;scalar=true; }
      else if(sql.contains("event_name='round_prestart'") || sql.contains("event_name IN ('round_officially_ended','round_prestart')")) {
        scalar=true;
        if(sql.contains("tick>?"))tick=4780L;
      } else if(sql.contains("event_name='round_officially_ended'")) { tick=officialEnd;scalar=true; }
      else if(sql.startsWith("SELECT MIN(tick) FROM player_positions")) { tick=1182L;scalar=true; }
      if(scalar) {
        when(rows.next()).thenReturn(true,false);
        when(rows.getObject(1)).thenReturn(tick);
        when(rows.getLong(1)).thenReturn(tick==null?0L:tick);
      }
      return statement;
    });
    return new DemoService(database).replay(2,1,1316);
  }

  @Test void freezeAtOriginIsAlreadyLiveNotAnExtraFifteenSecondBuyingPhase() throws Exception {
    Map<String,Object> result=replay(1182L);
    assertEquals(1182L,result.get("startTick"));
    assertEquals(1182L,result.get("freezeEndTick"));
    assertEquals(1316L,result.get("globalTick"));
  }

  @Test void missingFreezeEventStaysUnknownWithoutChangingRoundOrCursor() throws Exception {
    Map<String,Object> result=replay(null);
    assertNull(result.get("freezeEndTick"));
    assertEquals(1182L,result.get("startTick"));
    assertEquals(4780L,result.get("endTick"));
    assertEquals(1316L,result.get("globalTick"));
  }

  @Test void recordedNormalFreezeIsPreserved() throws Exception {
    assertEquals(2142L,replay(2142L).get("freezeEndTick"));
  }

  @Test void recordedLongTechnicalPauseIsNotClampedToFifteenSeconds() throws Exception {
    assertEquals(3102L,replay(3102L).get("freezeEndTick"));
  }

  @Test void missingPrestartUsesOfficiallyEndedBoundary() throws Exception {
    assertEquals(2000L,replay(2142L,2000L).get("startTick"));
  }
}
