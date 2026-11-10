CREATE TABLE "safety_terms" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"term" text NOT NULL,
	"category" text,
	"weight" integer DEFAULT 50 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "safety_terms_kind_term_idx" ON "safety_terms" USING btree ("kind","term");
--> statement-breakpoint
INSERT INTO safety_terms (id, kind, term, category, weight, active, note) VALUES ('seed-stop-01', 'STOP', 'гарантирован доход', 'A', 90, true, 'Мошенничество: «инвестиции» с гарантированным доходом (A3)') ON CONFLICT (kind, term) DO NOTHING;
--> statement-breakpoint
INSERT INTO safety_terms (id, kind, term, category, weight, active, note) VALUES ('seed-stop-02', 'STOP', 'гарантирован прибыл', 'A', 90, true, 'Мошенничество: гарантированная прибыль (A3)') ON CONFLICT (kind, term) DO NOTHING;
--> statement-breakpoint
INSERT INTO safety_terms (id, kind, term, category, weight, active, note) VALUES ('seed-stop-03', 'STOP', 'оплатите достав', 'A', 90, true, 'Мошенничество: «вы выиграли — оплатите доставку» (A3)') ON CONFLICT (kind, term) DO NOTHING;
--> statement-breakpoint
INSERT INTO safety_terms (id, kind, term, category, weight, active, note) VALUES ('seed-stop-04', 'STOP', 'вы выиграли', 'A', 60, true, 'Фальшивые розыгрыши (A3)') ON CONFLICT (kind, term) DO NOTHING;
--> statement-breakpoint
INSERT INTO safety_terms (id, kind, term, category, weight, active, note) VALUES ('seed-stop-05', 'STOP', 'финансов пирамид', 'A', 40, true, 'Финансовые пирамиды (A3)') ON CONFLICT (kind, term) DO NOTHING;
--> statement-breakpoint
INSERT INTO safety_terms (id, kind, term, category, weight, active, note) VALUES ('seed-stop-06', 'STOP', 'купить наркот', 'B', 100, true, 'Продажа наркотиков (B1)') ON CONFLICT (kind, term) DO NOTHING;
--> statement-breakpoint
INSERT INTO safety_terms (id, kind, term, category, weight, active, note) VALUES ('seed-stop-07', 'STOP', 'заказать наркот', 'B', 100, true, 'Продажа наркотиков (B1)') ON CONFLICT (kind, term) DO NOTHING;
--> statement-breakpoint
INSERT INTO safety_terms (id, kind, term, category, weight, active, note) VALUES ('seed-stop-08', 'STOP', 'купить мефедрон', 'B', 100, true, 'Продажа наркотиков (B1)') ON CONFLICT (kind, term) DO NOTHING;
--> statement-breakpoint
INSERT INTO safety_terms (id, kind, term, category, weight, active, note) VALUES ('seed-stop-09', 'STOP', 'купить амфетамин', 'B', 100, true, 'Продажа наркотиков (B1)') ON CONFLICT (kind, term) DO NOTHING;
--> statement-breakpoint
INSERT INTO safety_terms (id, kind, term, category, weight, active, note) VALUES ('seed-stop-10', 'STOP', 'купить кокаин', 'B', 100, true, 'Продажа наркотиков (B1)') ON CONFLICT (kind, term) DO NOTHING;
--> statement-breakpoint
INSERT INTO safety_terms (id, kind, term, category, weight, active, note) VALUES ('seed-stop-11', 'STOP', 'купить героин', 'B', 100, true, 'Продажа наркотиков (B1)') ON CONFLICT (kind, term) DO NOTHING;
--> statement-breakpoint
INSERT INTO safety_terms (id, kind, term, category, weight, active, note) VALUES ('seed-stop-12', 'STOP', 'купить марихуан', 'B', 100, true, 'Продажа наркотиков (B1)') ON CONFLICT (kind, term) DO NOTHING;
--> statement-breakpoint
INSERT INTO safety_terms (id, kind, term, category, weight, active, note) VALUES ('seed-stop-13', 'STOP', 'мефедрон', 'B', 60, true, 'Наркотики (B1)') ON CONFLICT (kind, term) DO NOTHING;
--> statement-breakpoint
INSERT INTO safety_terms (id, kind, term, category, weight, active, note) VALUES ('seed-stop-14', 'STOP', 'курительн смес', 'B', 60, true, 'Наркотики (B1)') ON CONFLICT (kind, term) DO NOTHING;
--> statement-breakpoint
INSERT INTO safety_terms (id, kind, term, category, weight, active, note) VALUES ('seed-stop-15', 'STOP', 'способы самоубийств', 'B', 100, true, 'Самоубийство (B2)') ON CONFLICT (kind, term) DO NOTHING;
--> statement-breakpoint
INSERT INTO safety_terms (id, kind, term, category, weight, active, note) VALUES ('seed-stop-16', 'STOP', 'как покончить с собой', 'B', 100, true, 'Самоубийство (B2)') ON CONFLICT (kind, term) DO NOTHING;
--> statement-breakpoint
INSERT INTO safety_terms (id, kind, term, category, weight, active, note) VALUES ('seed-stop-17', 'STOP', 'группы смерти', 'B', 100, true, 'Самоубийство (B2)') ON CONFLICT (kind, term) DO NOTHING;
--> statement-breakpoint
INSERT INTO safety_terms (id, kind, term, category, weight, active, note) VALUES ('seed-stop-18', 'STOP', 'онлайн казино', 'B', 60, true, 'Азартные игры (B3)') ON CONFLICT (kind, term) DO NOTHING;
--> statement-breakpoint
INSERT INTO safety_terms (id, kind, term, category, weight, active, note) VALUES ('seed-stop-19', 'STOP', 'казино', 'B', 40, true, 'Азартные игры (B3)') ON CONFLICT (kind, term) DO NOTHING;
--> statement-breakpoint
INSERT INTO safety_terms (id, kind, term, category, weight, active, note) VALUES ('seed-stop-20', 'STOP', 'ставки на спорт', 'B', 40, true, 'Азартные игры (B3)') ON CONFLICT (kind, term) DO NOTHING;
--> statement-breakpoint
INSERT INTO safety_terms (id, kind, term, category, weight, active, note) VALUES ('seed-stop-21', 'STOP', 'букмекер', 'B', 40, true, 'Азартные игры (B3)') ON CONFLICT (kind, term) DO NOTHING;
--> statement-breakpoint
INSERT INTO safety_terms (id, kind, term, category, weight, active, note) VALUES ('seed-stop-22', 'STOP', 'порн', 'B', 60, true, 'Откровенный сексуальный контент (B4)') ON CONFLICT (kind, term) DO NOTHING;
--> statement-breakpoint
INSERT INTO safety_terms (id, kind, term, category, weight, active, note) VALUES ('seed-stop-23', 'STOP', 'интим фото', 'B', 60, true, 'Интимные изображения (B5)') ON CONFLICT (kind, term) DO NOTHING;
--> statement-breakpoint
INSERT INTO safety_terms (id, kind, term, category, weight, active, note) VALUES ('seed-stop-24', 'STOP', 'слив фото', 'B', 60, true, 'Интимные изображения без согласия (B5)') ON CONFLICT (kind, term) DO NOTHING;
