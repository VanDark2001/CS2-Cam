self.onmessage = ({ data }) => {
  const { players = [], tick } = data
  self.postMessage({ tick, players: players.map((player) => ({ ...player, x: Number(player.x), y: Number(player.y) })) })
}

