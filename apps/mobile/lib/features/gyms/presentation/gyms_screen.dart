import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/utils/format.dart';
import '../../../core/widgets/common.dart';
import '../../../core/widgets/error_text.dart';
import '../../../core/widgets/gym_logo.dart';
import '../../../core/widgets/skeleton.dart';
import '../../../core/widgets/sport_chip.dart';
import '../../onboarding/data/reference_repository.dart';
import '../data/gyms_repository.dart';

/// Sports worth a filter chip, in display order.
const _filterSports = ['CROSSFIT', 'HYROX', 'BODYBUILDING', 'POWERLIFTING', 'FUNCTIONAL', 'RUNNING'];

/// Gym directory: search, sport and governorate filters, infinite paging (spec §6).
class GymsScreen extends ConsumerStatefulWidget {
  const GymsScreen({super.key});

  @override
  ConsumerState<GymsScreen> createState() => _GymsScreenState();
}

class _GymsScreenState extends ConsumerState<GymsScreen> {
  final _items = <Map<String, dynamic>>[];
  final _scroll = ScrollController();
  String _q = '';
  String? _sport;
  String? _gov;
  String? _cursor;
  bool _hasMore = true;
  bool _loading = false;
  Object? _error;
  Timer? _debounce;
  int _generation = 0;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(() {
      if (_scroll.position.pixels > _scroll.position.maxScrollExtent - 300) _load();
    });
    WidgetsBinding.instance.addPostFrameCallback((_) => _reload());
  }

  @override
  void dispose() {
    _scroll.dispose();
    _debounce?.cancel();
    super.dispose();
  }

  void _reload() {
    _generation++;
    setState(() {
      _items.clear();
      _cursor = null;
      _hasMore = true;
      _error = null;
      _loading = false;
    });
    _load();
  }

  Future<void> _load() async {
    if (_loading || !_hasMore) return;
    final gen = _generation;
    setState(() => _loading = true);
    try {
      final page = await ref.read(gymsRepositoryProvider).list(q: _q, sport: _sport, governorateId: _gov, cursor: _cursor);
      if (!mounted || gen != _generation) return; // a newer search replaced this one
      final meta = page['page'] as Map<String, dynamic>;
      setState(() {
        _items.addAll((page['data'] as List).cast<Map<String, dynamic>>());
        _cursor = meta['nextCursor'] as String?;
        _hasMore = meta['hasMore'] == true;
      });
    } catch (e) {
      if (mounted && gen == _generation) setState(() => _error = e);
    } finally {
      if (mounted && gen == _generation) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final sports = ref.watch(sportsProvider).valueOrNull ?? const [];
    final govs = ref.watch(governoratesProvider).valueOrNull ?? const [];
    final locale = Localizations.localeOf(context).languageCode;
    final govName = _gov == null ? null : govs.where((g) => g['id'] == _gov).map((g) => localized(g['name'], locale)).firstOrNull;
    return Scaffold(
      appBar: AppBar(title: Text(l.gymsTitle), actions: [
        IconButton(tooltip: l.addMyGym, icon: const Icon(Icons.add_business_outlined), onPressed: () => context.push('/gyms/new')),
      ]),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
          child: TextField(
            key: const Key('gym-search'),
            decoration: InputDecoration(prefixIcon: const Icon(Icons.search_rounded), hintText: l.gymsSearchHint),
            textInputAction: TextInputAction.search,
            onChanged: (v) {
              _debounce?.cancel();
              _debounce = Timer(const Duration(milliseconds: 350), () {
                _q = v.trim();
                _reload();
              });
            },
          ),
        ),
        SizedBox(
          height: 52,
          child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 12), children: [
            for (final code in _filterSports)
              for (final s in sports.where((s) => s['code'] == code))
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 4),
                  child: SportChip(
                    code: code,
                    name: s['name'],
                    selected: _sport == code,
                    onTap: () {
                      _sport = _sport == code ? null : code;
                      _reload();
                    },
                  ),
                ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 4),
              child: PopupMenuButton<String>(
                tooltip: l.gymsGovernorate,
                onSelected: (id) {
                  _gov = id.isEmpty ? null : id;
                  _reload();
                },
                itemBuilder: (_) => [
                  PopupMenuItem(value: '', child: Text(l.gymsAllGovernorates)),
                  for (final g in govs) PopupMenuItem(value: g['id'] as String, child: Text(localized(g['name'], locale))),
                ],
                child: Chip(avatar: const Icon(Icons.place_outlined, size: 16), label: Text(govName ?? l.gymsGovernorate)),
              ),
            ),
          ]),
        ),
        Expanded(child: _body(l)),
      ]),
    );
  }

  Widget _body(AppLocalizations l) {
    if (_items.isEmpty && _error != null) return ErrorView(error: _error!, onRetry: _reload);
    if (_items.isEmpty && (_loading || _hasMore)) return const SkeletonList();
    if (_items.isEmpty) return EmptyState(icon: Icons.storefront_outlined, message: l.gymsEmpty);
    return RefreshIndicator(
      onRefresh: () async => _reload(),
      child: ListView.separated(
        controller: _scroll,
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        itemCount: _items.length + (_hasMore ? 1 : 0),
        separatorBuilder: (_, _) => const SizedBox(height: 10),
        itemBuilder: (context, i) => i == _items.length
            ? const Padding(padding: EdgeInsets.all(16), child: Center(child: CircularProgressIndicator()))
            : GymCard(gym: _items[i]),
      ),
    );
  }
}

/// Directory card: logo, name + verified badge, city, sports, members.
class GymCard extends StatelessWidget {
  const GymCard({super.key, required this.gym});
  final Map<String, dynamic> gym;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context);
    final locale = Localizations.localeOf(context).languageCode;
    final sports = (gym['sports'] as List? ?? const []).cast<Map<String, dynamic>>();
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => context.push('/gyms/${gym['id']}'),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            GymLogo(name: gym['name'] as String, url: gym['logoUrl'] as String?),
            const SizedBox(width: 14),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Flexible(child: Text(gym['name'] as String, style: t.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800), overflow: TextOverflow.ellipsis)),
                  if (gym['verified'] == true)
                    Padding(padding: const EdgeInsetsDirectional.only(start: 6), child: Icon(Icons.verified_rounded, size: 18, color: t.colorScheme.primary, semanticLabel: l.gymVerified)),
                ]),
                const SizedBox(height: 2),
                Row(children: [
                  Icon(Icons.place_outlined, size: 14, color: t.colorScheme.outline),
                  const SizedBox(width: 2),
                  Flexible(child: Text(localized(gym['city'], locale), style: t.textTheme.bodySmall?.copyWith(color: t.colorScheme.outline), overflow: TextOverflow.ellipsis)),
                  const SizedBox(width: 10),
                  Icon(Icons.groups_2_outlined, size: 14, color: t.colorScheme.outline),
                  const SizedBox(width: 2),
                  Text(l.gymMembersCount(gym['membersCount'] as int), style: t.textTheme.bodySmall?.copyWith(color: t.colorScheme.outline)),
                ]),
                const SizedBox(height: 8),
                Wrap(spacing: 6, runSpacing: 6, children: [for (final s in sports.take(3)) SportChip(code: s['code'] as String, name: s['name'])]),
              ]),
            ),
          ]),
        ),
      ),
    );
  }
}
