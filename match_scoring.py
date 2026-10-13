"""CS2 regulation/overtime side mapping and persisted match score repair."""


def sides_differ_from_final(round_number: int, total_rounds: int) -> bool:
    """Whether a round's T/CT sides are opposite to the final-round sides."""
    swaps = 1 if round_number <= 12 < total_rounds else 0
    boundary = 27
    while boundary < total_rounds:
        if round_number <= boundary:
            swaps += 1
        boundary += 3
    return swaps % 2 == 1


def score_round_winners(winners: list[str]) -> dict[int, int]:
    """Map ordered T/CT round winners to teams identified by their final sides."""
    total_rounds = len(winners)
    scores = {2: 0, 3: 0}
    for round_number, winner in enumerate(winners, start=1):
        side = 2 if str(winner).upper() == "T" else 3 if str(winner).upper() == "CT" else 0
        if not side:
            continue
        if sides_differ_from_final(round_number, total_rounds):
            side = 5 - side
        scores[side] += 1
    return scores


def repair_match_scores(connection) -> int:
    """Recalculate stored scores from ordered official round_end events."""
    repaired = 0
    with connection.cursor() as cursor:
        cursor.execute("SELECT id,final_score_t,final_score_ct FROM matches ORDER BY id")
        matches = cursor.fetchall()
        for match_id, old_t, old_ct in matches:
            cursor.execute(
                "SELECT JSON_EXTRACT(data_json,'$.winner') winner "
                "FROM events WHERE match_id=? AND event_name='round_end' "
                "AND JSON_EXTRACT(data_json,'$.winner') IN ('T','CT') "
                "ORDER BY tick,id",
                (match_id,),
            )
            winners = [row[0] for row in cursor.fetchall()]
            if not winners:
                continue
            scores = score_round_winners(winners)
            if old_t != scores[2] or old_ct != scores[3]:
                cursor.execute(
                    "UPDATE matches SET final_score_t=?,final_score_ct=? WHERE id=?",
                    (scores[2], scores[3], match_id),
                )
                repaired += 1
    connection.commit()
    return repaired
