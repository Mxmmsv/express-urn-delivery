export interface NewsItem {
  id: string;
  title: string;
  url: string;
  publishedAt: string | null;
  text: string;
  imageUrl: string | null;
}

export interface DeliveryAttempt {
  channelId: string;
  boundaryMessageId: string | null;
  nonce: string;
}

export interface PendingNews {
  news: NewsItem;
  attempt: DeliveryAttempt | null;
}

export interface DeliveryReceipt {
  newsId: string;
  channelId: string;
  messageId: string;
}

export interface GuildNewsState {
  knownIds: string[];
  pending: PendingNews[];
  delivered: DeliveryReceipt[];
}

export interface NewsState {
  version: 1;
  guilds: Record<string, GuildNewsState>;
}
