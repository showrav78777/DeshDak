export type ReelRankingSignals = {
  viewCount: number;
  completedViewCount: number;
  totalWatchTimeMs: bigint | number;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  saveCount: number;
  productClickCount: number;
  publishedAt: Date;
  affinity: number;
  explorationSeed: number;
};

export function reelRankingScore(signals: ReelRankingSignals, now = new Date()) {
  const views = Math.max(1, signals.viewCount);
  const completionRate = Math.min(1, signals.completedViewCount / views);
  const averageWatchSeconds = Math.min(120, Number(signals.totalWatchTimeMs) / views / 1000);
  const engagementPerView = Math.min(1, (signals.likeCount * 3 + signals.commentCount * 5 + signals.shareCount * 6 + signals.saveCount * 4 + signals.productClickCount * 5) / views);
  const ageHours = Math.max(0, (now.getTime() - signals.publishedAt.getTime()) / 3_600_000);
  const freshness = Math.exp(-ageHours / (24 * 14));
  // Give an approved Reel a brief, bounded chance to collect genuine engagement.
  // Without this, a new Reel can never enter the first feed page while established
  // Reels already have strong completion and interaction signals.
  const initialDistribution = views < 10 && ageHours < 24 ? (1 - ageHours / 24) * 45 : 0;
  const exploration = Math.max(0, Math.min(1, signals.explorationSeed));
  const affinity = Math.max(0, Math.min(1, signals.affinity));

  return completionRate * 30
    + Math.min(1, averageWatchSeconds / 30) * 20
    + engagementPerView * 20
    + affinity * 15
    + freshness * 10
    + initialDistribution
    + exploration * 4
    + Math.log10(views + 1) * 0.5;
}

export function stableExplorationSeed(reelCode: string, viewerKey: string) {
  let hash = 2166136261;
  for (const character of `${reelCode}:${viewerKey}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0) / 0xffffffff;
}
