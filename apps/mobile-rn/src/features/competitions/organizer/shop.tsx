import { useQueryClient } from '@tanstack/react-query';
import { getRandomBytes } from 'expo-crypto';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import type { Json } from '../../../core/api/client';
import { useLocale, useT } from '../../../core/prefs';
import { useApi } from '../../../core/services';
import { space, useTheme } from '../../../core/theme';
import { SectionHeader, SkeletonList, StatusPill } from '../../../core/widgets/common';
import { ErrorText } from '../../../core/widgets/error';
import { Button, Card, Chip, IconButton, Screen, TextField, Txt, toast } from '../../../core/widgets/kit';
import { useMe } from '../../me/api';
import { formatMoney, useCompetition } from '../api';
import { LocalBadge } from './local-badge';
import { toMillimes } from './logic';
import { availability, orderProblems, revenue, ticketCode, type Order } from './logic-shop';
import { OrgPageHeader } from './page';
import { useLocalList } from './roster';

const int = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : null);
const sizesFrom = (s: string) => [...new Set(s.split(/[,;\s]+/).map((x) => x.trim().toUpperCase()).filter(Boolean))];

/** Writes to a local list of the competition, then reads it again. */
function useLocalWrite(id: string, path: string) {
  const api = useApi();
  const qc = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ['competitions', id, 'local', path] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return { api, run, error, busy };
}

const asOrders = (x: Json[] | undefined) => (x ?? []) as (Order & Json)[];

// ───────────── Organizer: tickets ─────────────

/** Phase 11: spectator ticket types, the orders (paid on site, ruling 8) and the check-in at the door by code. */
export function TicketsTab({ c }: { c: Json }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const types = useLocalList(c.id, 'ticket-types');
  const orders = useLocalList(c.id, 'ticket-orders');
  const typesW = useLocalWrite(c.id, 'ticket-types');
  const ordersW = useLocalWrite(c.id, 'ticket-orders');
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [limit, setLimit] = useState('');
  const [code, setCode] = useState('');
  const [check, setCheck] = useState<string | null>(null);
  const now = Date.now();
  const money = (m: number) => formatMoney(m, c.currency ?? 'TND', locale);
  const list = types.data ?? [];
  const all = asOrders(orders.data);
  const canAdd = !!name.trim() && toMillimes(price) != null && (!limit.trim() || (int(limit) ?? 0) > 0);
  const typeName = (id: string) => list.find((x) => x.id === id)?.name ?? '—';

  /** Reads the orders again first: another device may have checked the ticket in a moment ago. */
  const checkIn = () =>
    ordersW.run(async () => {
      const fresh = asOrders(await ordersW.api.get<Json[]>(`/competitions/${c.id}/ticket-orders`));
      const o = fresh.find((x) => x.code === code.trim().toUpperCase());
      const line = o ? { item: typeName(o.itemId), quantity: o.quantity, name: o.name } : null;
      if (!o || !line || o.status === 'CANCELLED') return setCheck(t('tkUnknown'));
      if (o.status === 'USED') return setCheck(t('tkUsed'));
      if (o.status !== 'PAID') return setCheck(t('tkUnpaid', { item: line.item, quantity: line.quantity, name: line.name }));
      await ordersW.api.put(`/competitions/${c.id}/ticket-orders/${o.id}`, { status: 'USED' });
      setCheck(t('tkValid', { item: line.item, quantity: line.quantity, name: line.name }));
    });

  return (
    <>
      <OrgPageHeader tab="tickets" />
      <Screen>
        <View style={{ alignSelf: 'flex-start' }}>
          <LocalBadge />
        </View>
        <SectionHeader title={t('tkTypes')} />
        {list.map((x) => {
          const a = availability({ id: x.id, limit: x.limit ?? null, salesEnd: x.salesEnd }, all, now);
          return (
            <Card key={x.id} testID={`tk-type-${x.id}`} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt variant="title">{x.name}</Txt>
                <Txt color={colors.outline}>{`${money(x.price)} · ${x.limit != null ? t('tkSold', { sold: a.sold, limit: x.limit }) : t('tkSoldNoLimit', { sold: a.sold })}`}</Txt>
              </View>
              {a.sold === 0 ? <IconButton testID={`tk-remove-${x.id}`} icon="delete" label={t('tkRemove')} onPress={() => void typesW.run(() => typesW.api.delete(`/competitions/${c.id}/ticket-types/${x.id}`))} /> : null}
            </Card>
          );
        })}
        <Card style={{ gap: space.sm }}>
          <TextField testID="tk-name" label={t('tkName')} value={name} onChangeText={setName} maxLength={60} />
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <TextField testID="tk-price" style={{ flex: 1 }} label={t('tkPrice')} value={price} onChangeText={setPrice} keyboardType="decimal-pad" />
            <TextField testID="tk-limit" style={{ flex: 1 }} label={t('tkLimit')} value={limit} onChangeText={setLimit} keyboardType="number-pad" />
          </View>
          <ErrorText error={typesW.error} />
          <Button
            testID="tk-add"
            icon="add"
            label={t('tkAdd')}
            busy={typesW.busy}
            disabled={!canAdd}
            onPress={() =>
              void typesW.run(async () => {
                await typesW.api.post(`/competitions/${c.id}/ticket-types`, { name: name.trim(), price: toMillimes(price), limit: int(limit), salesEnd: null });
                setName('');
                setPrice('');
                setLimit('');
              })
            }
          />
        </Card>

        <SectionHeader title={t('tkDoor')} />
        <Card style={{ gap: space.sm }}>
          <TextField
            testID="tk-check"
            label={t('tkCheck')}
            value={code}
            onChangeText={(v) => {
              setCode(v);
              setCheck(null);
            }}
            autoCapitalize="characters"
          />
          <Button testID="tk-check-go" icon="qr-code-scanner" label={t('tkCheckGo')} busy={ordersW.busy} disabled={!code.trim()} onPress={() => void checkIn()} />
          {check ? <Txt testID="tk-check-result" style={{ fontWeight: '700' }}>{check}</Txt> : null}
        </Card>

        <OrdersCard c={c} items={list} orders={all} write={ordersW} next={{ RESERVED: 'PAID' }} testPrefix="tk" />
      </Screen>
    </>
  );
}

/** The orders of tickets or products, with the next step of each (mark paid, picked up). */
function OrdersCard({ c, items, orders, write, next, testPrefix }: { c: Json; items: Json[]; orders: (Order & Json)[]; write: ReturnType<typeof useLocalWrite>; next: Record<string, string>; testPrefix: 'tk' | 'sh' }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const path = testPrefix === 'tk' ? 'ticket-orders' : 'shop-orders';
  const label = (to: string) => (to === 'PAID' ? t('tkMarkPaid') : t('shPickedUp'));
  const sorted = [...orders].sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
  return (
    <>
      <SectionHeader title={t('tkOrders')} />
      <Txt testID={`${testPrefix}-revenue`} style={{ fontWeight: '700' }}>{t('tkRevenue', { amount: formatMoney(revenue(items as { id: string; price: number }[], orders), c.currency ?? 'TND', locale) })}</Txt>
      <Card style={{ gap: space.sm }}>
        {sorted.length === 0 ? <Txt color={colors.outline}>{t('tkOrdersEmpty')}</Txt> : null}
        {sorted.map((o) => {
          const to = next[o.status];
          const item = items.find((x) => x.id === o.itemId)?.name ?? '—';
          return (
            <View key={o.id} testID={`${testPrefix}-order-${o.id}`} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <View style={{ flex: 1 }}>
                <Txt>{t('tkOrderLine', { name: o.name ?? '—', item: o.size ? `${item} (${o.size})` : item, quantity: o.quantity })}</Txt>
                {o.code ? <Txt variant="small" color={colors.outline}>{o.code}</Txt> : null}
              </View>
              <StatusPill label={t(`tkStatus${o.status as 'RESERVED' | 'PAID' | 'USED' | 'PICKED_UP' | 'CANCELLED'}`)} color={o.status === 'RESERVED' ? colors.warning : colors.success} />
              {to ? <Button testID={`${testPrefix}-${to === 'PAID' ? 'paid' : 'picked'}-${o.id}`} kind="tonal" label={label(to)} busy={write.busy} onPress={() => void write.run(() => write.api.put(`/competitions/${c.id}/${path}/${o.id}`, { status: to }))} /> : null}
            </View>
          );
        })}
      </Card>
      <ErrorText error={write.error} />
    </>
  );
}

// ───────────── Organizer: shop ─────────────

/** Phase 11: the event shop (merchandise with sizes and stock) and its orders. */
export function ShopTab({ c }: { c: Json }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const products = useLocalList(c.id, 'shop-products');
  const orders = useLocalList(c.id, 'shop-orders');
  const productsW = useLocalWrite(c.id, 'shop-products');
  const ordersW = useLocalWrite(c.id, 'shop-orders');
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');
  const [sizes, setSizes] = useState('');
  const list = products.data ?? [];
  const all = asOrders(orders.data);
  const canAdd = !!name.trim() && toMillimes(price) != null && (!stock.trim() || (int(stock) ?? 0) > 0);
  return (
    <>
      <OrgPageHeader tab="shop" />
      <Screen>
        <View style={{ alignSelf: 'flex-start' }}>
          <LocalBadge />
        </View>
        <SectionHeader title={t('shProducts')} />
        {list.map((x) => {
          const a = availability({ id: x.id, limit: x.limit ?? null }, all, Date.now());
          return (
            <Card key={x.id} testID={`sh-product-${x.id}`} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt variant="title">{x.name}</Txt>
                <Txt color={colors.outline}>{[formatMoney(x.price, c.currency ?? 'TND', locale), (x.sizes ?? []).join(' · '), x.limit != null ? t('tkSold', { sold: a.sold, limit: x.limit }) : t('tkSoldNoLimit', { sold: a.sold })].filter(Boolean).join(' · ')}</Txt>
              </View>
              {a.sold === 0 ? <IconButton testID={`sh-remove-${x.id}`} icon="delete" label={t('tkRemove')} onPress={() => void productsW.run(() => productsW.api.delete(`/competitions/${c.id}/shop-products/${x.id}`))} /> : null}
            </Card>
          );
        })}
        <Card style={{ gap: space.sm }}>
          <TextField testID="sh-name" label={t('tkName')} value={name} onChangeText={setName} maxLength={60} />
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <TextField testID="sh-price" style={{ flex: 1 }} label={t('tkPrice')} value={price} onChangeText={setPrice} keyboardType="decimal-pad" />
            <TextField testID="sh-stock" style={{ flex: 1 }} label={t('shStock')} value={stock} onChangeText={setStock} keyboardType="number-pad" />
          </View>
          <TextField testID="sh-sizes" label={t('shSizes')} value={sizes} onChangeText={setSizes} autoCapitalize="characters" />
          <ErrorText error={productsW.error} />
          <Button
            testID="sh-add"
            icon="add"
            label={t('tkAdd')}
            busy={productsW.busy}
            disabled={!canAdd}
            onPress={() =>
              void productsW.run(async () => {
                await productsW.api.post(`/competitions/${c.id}/shop-products`, { name: name.trim(), price: toMillimes(price), limit: int(stock), sizes: sizesFrom(sizes) });
                setName('');
                setPrice('');
                setStock('');
                setSizes('');
              })
            }
          />
        </Card>
        <OrdersCard c={c} items={list} orders={all} write={ordersW} next={{ RESERVED: 'PAID', PAID: 'PICKED_UP' }} testPrefix="sh" />
      </Screen>
    </>
  );
}

// ───────────── Public: tickets and shop ─────────────

/** On the event page: the way to the tickets and the shop, when the organizer sells something. */
export function ShopLink({ id }: { id: string }) {
  const t = useT();
  const { colors } = useTheme();
  const types = useLocalList(id, 'ticket-types');
  const products = useLocalList(id, 'shop-products');
  if (!(types.data ?? []).length && !(products.data ?? []).length) return null;
  return (
    <Card testID="comp-shop" style={{ gap: space.sm }}>
      <Txt variant="title">{t('shopTitle')}</Txt>
      <Txt color={colors.outline}>{t('shopOpenHint')}</Txt>
      <Button testID="comp-shop-open" icon="local-activity" label={t('shopTitle')} onPress={() => router.push(`/competitions/${id}/shop`)} />
    </Card>
  );
}

/** Phase 11: spectators and athletes reserve tickets and products; they pay on site (ruling 8). */
export function PublicShopScreen({ id }: { id: string }) {
  const t = useT();
  const { colors } = useTheme();
  const comp = useCompetition(id);
  const types = useLocalList(id, 'ticket-types');
  const products = useLocalList(id, 'shop-products');
  const ticketOrders = useLocalList(id, 'ticket-orders');
  const shopOrders = useLocalList(id, 'shop-orders');
  if (!comp.data || !types.data || !products.data || !ticketOrders.data || !shopOrders.data) return <SkeletonList count={3} height={120} />;
  const empty = types.data.length === 0 && products.data.length === 0;
  return (
    <Screen>
      <Stack.Screen options={{ title: t('shopTitle') }} />
      <Txt variant="title">{comp.data.title}</Txt>
      <Txt variant="small" color={colors.outline}>{t('shopLocalHint')}</Txt>
      {empty ? <Txt color={colors.outline}>{t('shopEmpty')}</Txt> : null}
      {types.data.length ? <SectionHeader title={t('shopTickets')} /> : null}
      {types.data.map((x) => (
        <BuyCard key={x.id} c={comp.data} item={x} orders={asOrders(ticketOrders.data)} path="ticket-orders" ticket />
      ))}
      {products.data.length ? <SectionHeader title={t('shopProducts')} /> : null}
      {products.data.map((x) => (
        <BuyCard key={x.id} c={comp.data} item={x} orders={asOrders(shopOrders.data)} path="shop-orders" />
      ))}
    </Screen>
  );
}

function BuyCard({ c, item, orders, path, ticket }: { c: Json; item: Json; orders: (Order & Json)[]; path: 'ticket-orders' | 'shop-orders'; ticket?: boolean }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const me = useMe();
  const write = useLocalWrite(c.id, path);
  const [qty, setQty] = useState('1');
  const [size, setSize] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const sizes: string[] = item.sizes ?? [];
  const now = Date.now();
  const spec = { id: item.id, limit: item.limit ?? null, salesEnd: item.salesEnd, sizes };
  const a = availability(spec, orders, now);
  const quantity = int(qty) ?? 0;
  const problems = orderProblems(spec, quantity, orders, now, size);
  const money = (m: number) => formatMoney(m, c.currency ?? 'TND', locale);
  const buyer = me.data?.profile?.fullName || me.data?.username || '—';

  const buy = () =>
    write.run(async () => {
      const code = ticket ? ticketCode(getRandomBytes(8)) : null;
      await write.api.post(`/competitions/${c.id}/${path}`, { itemId: item.id, quantity, status: 'RESERVED', userId: me.data?.id ?? null, name: buyer, ...(code ? { code } : {}), ...(sizes.length ? { size } : {}) });
      setDone(code);
      toast(ticket ? t('shopReserved', { code: code ?? '' }) : t('shopReservedProduct'));
    });

  return (
    <Card testID={`shop-item-${item.id}`} style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Txt variant="title" style={{ flex: 1 }}>{item.name}</Txt>
        <Txt style={{ fontWeight: '700' }}>{money(item.price)}</Txt>
      </View>
      <Txt color={a.onSale ? colors.outline : colors.error}>{a.left === 0 ? t('shopSoldOut') : !a.onSale ? t('shopClosed') : a.left != null ? t('shopLeft', { count: a.left }) : ''}</Txt>
      {sizes.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {sizes.map((s) => (
            <Chip key={s} testID={`shop-size-${item.id}-${s}`} label={s} selected={size === s} onPress={() => setSize(s)} />
          ))}
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.sm }}>
        <TextField testID={`shop-qty-${item.id}`} style={{ width: 120 }} label={t('shopQty')} value={qty} onChangeText={setQty} keyboardType="number-pad" />
        <Txt style={{ flex: 1, paddingBottom: space.sm }} color={colors.outline}>{quantity > 0 ? t('shopTotal', { amount: money(item.price * quantity) }) : ''}</Txt>
      </View>
      {problems.length && quantity > 0 && a.onSale ? <Txt color={colors.error}>{t(`shopProblem${problems[0]}`)}</Txt> : null}
      <ErrorText error={write.error} />
      <Button testID={`shop-buy-${item.id}`} icon="shopping-cart" label={t('shopBuy')} busy={write.busy} disabled={problems.length > 0} onPress={() => void buy()} />
      {done ? <Txt testID={`shop-code-${item.id}`} style={{ fontWeight: '700' }} color={colors.primary}>{t('shopReserved', { code: done })}</Txt> : null}
    </Card>
  );
}
