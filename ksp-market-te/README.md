# KSP Market T/E

KSP Market T/E es una plataforma de **bolsa de valores y almacén online ficticia** inspirada en Kerbal Space Program.

Todos los precios, empresas, acciones y la moneda (₡) son **100 % ficticios** y no tienen valor real.

## Estructura

- `ksp-stock-market/` → aplicación web principal (frontend + datos + bot)
- `ksp-stock-market/market-data.json` → estado actual del mercado (actualizado por el bot de Discord)
- `ksp-stock-market/supabase-schema.sql` → esquema y funciones del backend
- `.github/workflows/` → actualización automática cada 5 minutos desde Discord

## Empresas actuales

| Ticker | Nombre            | Sector       |
|--------|-------------------|--------------|
| KD     | Kerbin Dynamics   | Aeroespacial |
| JSA    | JS Aerospace      | Aeroespacial |

## Cómo funciona el mercado

1. El bot de Discord lee mensajes nuevos del canal configurado.
2. Si un mensaje menciona una empresa (nombre, ticker, alias, keyword o miembro relacionado), calcula un sentimiento.
3. Aplica un cambio de precio y guarda la noticia en `market-data.json`.
4. La web carga ese JSON y, si hay sesión en Supabase, permite operar en tiempo real.

## Desarrollo local

Abre `ksp-stock-market/index.html` con un servidor estático (o GitHub Pages).

```bash
npx serve ksp-stock-market
```

## Backend (Supabase)

1. Ejecuta `supabase-schema.sql` en el SQL Editor.
2. Copia la **anon key** real a `supabase-config.js`.
3. Activa Realtime para las tablas `companies` y `price_history`.

## Aviso legal

Este proyecto es solo para roleplay y entretenimiento. No es un mercado real ni ofrece consejos financieros.
