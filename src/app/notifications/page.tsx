import Link from "next/link";
import { redirect } from "next/navigation";
import { MarkAllNotificationsRead, MarkNotificationRead } from "@/components/notification-actions";
import { NotificationPreferenceManager } from "@/components/notification-preference-manager";
import { CustomerNav } from "@/components/store-header";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { getServerSession } from "@/lib/server-session";
import { notificationPreferenceItems } from "@/modules/notifications/preferences";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const session = await getServerSession();
  if (!session?.roles.includes(ROLE.CUSTOMER_PERSONAL)) redirect("/login?next=/notifications");
  const [notifications, user, savedPreferences] = await Promise.all([
    prisma.notification.findMany({ where: { userId: session.userId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100 }),
    prisma.user.findUniqueOrThrow({ where: { id: session.userId }, select: { locale: true } }),
    prisma.notificationPreference.findMany({ where: { userId: session.userId } }),
  ]);
  const useBangla = user.locale.toLowerCase().startsWith("bn");
  const unreadCount = notifications.filter((notification) => !notification.readAt).length;
  const preferenceItems = notificationPreferenceItems(savedPreferences, useBangla ? "bn" : "en");
  return <main className="dashboard-shell notification-shell"><CustomerNav session={session} /><section className="notification-page"><div className="notification-page-head"><div><p className="eyebrow">NOTIFICATIONS</p><h1>Product and account updates.</h1><p>Payment, purchasing, warehouse, shipping, delivery, refund, and security messages appear here.</p></div><MarkAllNotificationsRead disabled={unreadCount === 0} /></div><div className="notification-summary"><b>{unreadCount}</b><span>unread update{unreadCount === 1 ? "" : "s"}</span><small>Critical transactional messages remain available even when marketing is disabled.</small></div>{notifications.length ? <div className="notification-list">{notifications.map((notification) => { const title = useBangla && notification.titleBn ? notification.titleBn : notification.title; const body = useBangla && notification.bodyBn ? notification.bodyBn : notification.body; return <article className={notification.readAt ? "notification-card read" : `notification-card unread priority-${notification.priority.toLowerCase()}`} key={notification.id}><i aria-hidden="true">{notification.priority === "HIGH" || notification.priority === "CRITICAL" ? "!" : "✓"}</i><div><div className="notification-card-title"><h2>{title}</h2><time dateTime={notification.createdAt.toISOString()}>{notification.createdAt.toLocaleString()}</time></div><p>{body}</p><div className="notification-card-actions">{notification.deepLink ? <Link href={notification.deepLink}>View details →</Link> : <span />}<MarkNotificationRead notificationId={notification.id} read={Boolean(notification.readAt)} /></div></div></article>; })}</div> : <div className="notification-empty"><span>♢</span><h2>No notifications yet</h2><p>Confirmed updates for your orders and account will appear here.</p><Link className="button primary" href="/products">Browse products</Link></div>}<NotificationPreferenceManager initialItems={preferenceItems} locale={useBangla ? "bn" : "en"} /></section></main>;
}
