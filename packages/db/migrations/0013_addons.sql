CREATE TABLE "addons" (
	"code" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price_rub" integer NOT NULL,
	"params" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
-- P7.5: допродажи из docs/04-TARIFFS.md §3 (цены потом меняются в админке; повторный запуск строки не трогает).
INSERT INTO addons (code, title, description, price_rub, params, active, sort) VALUES ('PASS_COMPLETIONS_500', '+500 прохождений для «Праздника»', 'Добавляет 500 прохождений к сборке с пропуском «Праздник». Действует до конца пропуска.', 99, '{"effect":"PASS_COMPLETIONS","quantity":500}'::jsonb, true, 10) ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
INSERT INTO addons (code, title, description, price_rub, params, active, sort) VALUES ('PASS_EXTEND_30', 'Продление «Праздника» на 30 дней', 'Продлевает пропуск «Праздник» для той же сборки ещё на 30 дней.', 99, '{"effect":"PASS_EXTEND","days":30}'::jsonb, true, 20) ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
INSERT INTO addons (code, title, description, price_rub, params, active, sort) VALUES ('COMPLETIONS_1000', '+1 000 прохождений', 'Для подписок. Расходуются после месячного лимита и действуют 12 месяцев.', 149, '{"effect":"SUBSCRIPTION_COMPLETIONS","quantity":1000,"months":12}'::jsonb, true, 30) ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
INSERT INTO addons (code, title, description, price_rub, params, active, sort) VALUES ('STORAGE_10GB', '+10 ГБ хранилища на месяц', 'Для подписок. Добавляет 10 ГБ к хранилищу на 30 дней; можно купить несколько раз.', 149, '{"effect":"SUBSCRIPTION_STORAGE","quantity":10737418240,"months":1}'::jsonb, true, 40) ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
INSERT INTO addons (code, title, description, price_rub, params, active, sort) VALUES ('FREE_EXTRAS', '+5 своих тем и +100 правил для «Старта»', 'Навсегда, пока у вас тариф «Старт». Водяной знак остаётся.', 99, '{"effect":"FREE_EXTRAS","themes":5,"rules":100}'::jsonb, true, 50) ON CONFLICT (code) DO NOTHING;
