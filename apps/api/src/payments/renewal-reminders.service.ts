import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { and, eq, gt, inArray, lte } from 'drizzle-orm';
import { PLANS, schema, type Db } from '@blokum/db';
import { NotificationsService } from '../admin/notifications.service.js';
import { DB } from '../tokens.js';

const DAY = 24 * 60 * 60 * 1000;
const moscow = (d: Date): string => new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long', year: 'numeric' }).format(d);

/**
 * P7.4 · напоминания о конце срока: за 3 дня и за 1 день. Сообщение приходит в кабинет (решение владельца: почту не шлём, позже добавится
 * ВКонтакте). Автоматических списаний нет, поэтому в любом режиме текст один: срок заканчивается, продлить — «Оплатить» на карточке тарифа.
 * Каждое напоминание уходит один раз на срок: признак — вид сообщения `renewal:{подписка}:{конец срока}:{3|1}`; если сервис стоял и окно
 * «за 3 дня» уже прошло, отправляется только ближайшее («за 1 день»).
 */
@Injectable()
export class RenewalRemindersService implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly notices: NotificationsService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV !== 'production') return;
    this.timer = setInterval(() => void this.run().catch(() => undefined), 60 * 60 * 1000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Отправить напоминания, которые подошли; возвращает, сколько ушло. `now` — параметр, чтобы тесты выбирали время. */
  async run(now: Date = new Date()): Promise<number> {
    const due = await this.db
      .select()
      .from(schema.subscriptions)
      .where(and(inArray(schema.subscriptions.status, ['ACTIVE', 'TRIAL']), gt(schema.subscriptions.currentPeriodEnd, now), lte(schema.subscriptions.currentPeriodEnd, new Date(now.getTime() + 3 * DAY))));
    let sent = 0;
    for (const sub of due) {
      if (sub.canceledAt) continue;
      const left = sub.currentPeriodEnd.getTime() - now.getTime();
      const step = left <= DAY ? 1 : 3;
      const kind = `renewal:${sub.id}:${sub.currentPeriodEnd.toISOString()}:${step}`;
      const [again] = await this.db.select({ id: schema.notifications.id }).from(schema.notifications).where(and(eq(schema.notifications.userId, sub.userId), eq(schema.notifications.kind, kind)));
      if (again) continue;
      const plan = PLANS.find((p) => p.code === sub.planCode)?.title ?? sub.planCode;
      const when = moscow(sub.currentPeriodEnd);
      const title = step === 1 ? `Завтра закончится тариф «${plan}»` : `Через 3 дня закончится тариф «${plan}»`;
      const body = sub.trial
        ? `Пробный период тарифа «${plan}» заканчивается ${when}. Списаний не будет. Чтобы сохранить возможности тарифа, нажмите «Оплатить» на карточке тарифа в разделе «Тариф и оплата».`
        : `Тариф «${plan}» действует до ${when}. Автоматических списаний нет: чтобы продлить, нажмите «Оплатить» на карточке тарифа в разделе «Тариф и оплата» — новый срок прибавится к текущему.`;
      await this.notices.notify({ userId: sub.userId, kind, title, body, mail: false });
      sent += 1;
    }
    return sent;
  }
}
