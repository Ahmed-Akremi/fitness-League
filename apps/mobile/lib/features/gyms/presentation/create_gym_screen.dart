import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/utils/format.dart';
import '../../../core/widgets/error_text.dart';
import '../../../core/widgets/section_header.dart';
import '../../../core/widgets/sport_chip.dart';
import '../../onboarding/data/reference_repository.dart';
import '../data/gyms_repository.dart';

typedef PickedImage = ({Uint8List bytes, String name});

Future<PickedImage?> _galleryPicker() async {
  final file = await ImagePicker().pickImage(source: ImageSource.gallery, maxWidth: 1024, maxHeight: 1024, imageQuality: 90);
  if (file == null) return null;
  return (bytes: await file.readAsBytes(), name: file.name);
}

/// Gym owner: submit a gym for verification (details, sports, proof, photo). A platform admin approves it.
class CreateGymScreen extends ConsumerStatefulWidget {
  const CreateGymScreen({super.key, this.pickImage = _galleryPicker});

  /// Injected in tests (no platform picker there).
  final Future<PickedImage?> Function() pickImage;

  @override
  ConsumerState<CreateGymScreen> createState() => _CreateGymScreenState();
}

class _CreateGymScreenState extends ConsumerState<CreateGymScreen> {
  final _name = TextEditingController();
  final _address = TextEditingController();
  final _phone = TextEditingController();
  final _email = TextEditingController();
  final _instagram = TextEditingController();
  final _proof = TextEditingController();
  String? _governorateId;
  String? _cityId;
  final List<String> _sportIds = [];
  PickedImage? _photo;
  bool _busy = false;
  bool _submitted = false;
  Object? _error;

  @override
  void dispose() {
    for (final c in [_name, _address, _phone, _email, _instagram, _proof]) {
      c.dispose();
    }
    super.dispose();
  }

  bool get _valid {
    final phone = _phone.text.trim();
    final email = _email.text.trim();
    final insta = _instagram.text.trim();
    return _name.text.trim().length >= 3 &&
        _name.text.trim().length <= 80 &&
        _governorateId != null &&
        _cityId != null &&
        _proof.text.trim().length >= 10 &&
        (phone.isEmpty || RegExp(r'^\+[1-9]\d{7,14}$').hasMatch(phone)) &&
        (email.isEmpty || RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(email)) &&
        (insta.isEmpty || insta.startsWith('https://'));
  }

  Future<void> _pickPhoto() async {
    final l = context.l10n;
    final picked = await widget.pickImage();
    if (picked == null || !mounted) return;
    if (picked.bytes.length > 2 * 1024 * 1024) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l.logoTooLarge)));
      return;
    }
    setState(() => _photo = picked);
  }

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    final repo = ref.read(gymsRepositoryProvider);
    try {
      String opt(TextEditingController c) => c.text.trim();
      final created = await repo.create({
        'name': opt(_name),
        'governorateId': _governorateId,
        'cityId': _cityId,
        if (opt(_address).isNotEmpty) 'addressLine': opt(_address),
        if (opt(_phone).isNotEmpty) 'contactPhone': opt(_phone),
        if (opt(_email).isNotEmpty) 'contactEmail': opt(_email),
        if (opt(_instagram).isNotEmpty) 'socialLinks': {'instagram': opt(_instagram)},
        if (_sportIds.isNotEmpty) 'sportIds': _sportIds,
        'proofOfOwnership': opt(_proof),
      });
      if (_photo != null) await repo.uploadLogo(created['id'] as String, _photo!.bytes, _photo!.name);
      ref.invalidate(myGymsProvider);
      if (mounted) setState(() => _submitted = true);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context);
    final locale = Localizations.localeOf(context).languageCode;
    if (_submitted) {
      return Scaffold(
        appBar: AppBar(title: Text(l.addMyGym)),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.hourglass_top_rounded, size: 64, color: t.colorScheme.primary),
                const SizedBox(height: 16),
                Text(l.gymSubmitted, textAlign: TextAlign.center, style: t.textTheme.titleMedium),
              ],
            ),
          ),
        ),
      );
    }
    final govs = ref.watch(governoratesProvider).valueOrNull ?? const [];
    final cities = _governorateId == null ? const <Map<String, dynamic>>[] : (ref.watch(citiesProvider(_governorateId!)).valueOrNull ?? const []);
    final sports = ref.watch(sportsProvider).valueOrNull ?? const [];
    void changed(_) => setState(() {});
    return Scaffold(
      appBar: AppBar(title: Text(l.addMyGym)),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(l.addMyGymIntro, style: t.textTheme.bodyMedium?.copyWith(color: t.colorScheme.outline)),
          const SizedBox(height: 16),
          Center(
            child: InkWell(
              key: const Key('gym-photo'),
              borderRadius: BorderRadius.circular(28),
              onTap: _busy ? null : _pickPhoto,
              child: Container(
                width: 112,
                height: 112,
                decoration: BoxDecoration(color: t.colorScheme.surfaceContainerHighest, borderRadius: BorderRadius.circular(28)),
                clipBehavior: Clip.antiAlias,
                child: _photo == null
                    ? Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          const Icon(Icons.add_a_photo_outlined, size: 32),
                          const SizedBox(height: 6),
                          Text(l.gymPhoto, style: t.textTheme.labelMedium),
                        ],
                      )
                    : Image.memory(_photo!.bytes, fit: BoxFit.cover, errorBuilder: (_, _, _) => const Icon(Icons.check_circle_rounded, size: 40)),
              ),
            ),
          ),
          SectionHeader(title: l.gymDetails),
          TextField(
            key: const Key('gym-name'),
            controller: _name,
            maxLength: 80,
            decoration: InputDecoration(labelText: l.gymName),
            onChanged: changed,
          ),
          DropdownButtonFormField<String>(
            key: const Key('gym-governorate'),
            initialValue: _governorateId,
            decoration: InputDecoration(labelText: l.gymsGovernorate),
            items: [for (final g in govs) DropdownMenuItem(value: g['id'] as String, child: Text(localized(g['name'], locale)))],
            onChanged: (v) => setState(() {
              _governorateId = v;
              _cityId = null;
            }),
          ),
          const SizedBox(height: 12),
          KeyedSubtree(
            key: const Key('gym-city'),
            child: DropdownButtonFormField<String>(
              key: ValueKey('gym-city-$_governorateId'),
              initialValue: _cityId,
              decoration: InputDecoration(labelText: l.city),
              items: [for (final c in cities) DropdownMenuItem(value: c['id'] as String, child: Text(localized(c['name'], locale)))],
              onChanged: (v) => setState(() => _cityId = v),
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _address,
            maxLength: 200,
            decoration: InputDecoration(labelText: l.gymAddress),
          ),
          SectionHeader(title: l.gymSports),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final s in sports)
                SportChip(
                  code: s['code'] as String,
                  name: s['name'],
                  selected: _sportIds.contains(s['id']),
                  onTap: () => setState(() => _sportIds.contains(s['id']) ? _sportIds.remove(s['id']) : _sportIds.add(s['id'] as String)),
                ),
            ],
          ),
          SectionHeader(title: l.gymContact),
          TextField(
            controller: _phone,
            keyboardType: TextInputType.phone,
            decoration: InputDecoration(labelText: l.gymPhone, hintText: '+216…'),
            onChanged: changed,
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _email,
            keyboardType: TextInputType.emailAddress,
            decoration: InputDecoration(labelText: l.email),
            onChanged: changed,
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _instagram,
            keyboardType: TextInputType.url,
            decoration: const InputDecoration(labelText: 'Instagram', hintText: 'https://instagram.com/…'),
            onChanged: changed,
          ),
          SectionHeader(title: l.gymProof),
          TextField(
            key: const Key('gym-proof'),
            controller: _proof,
            minLines: 2,
            maxLines: 5,
            maxLength: 1000,
            decoration: InputDecoration(labelText: l.gymProofHint),
            onChanged: changed,
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(errorMessage(context, _error!), style: TextStyle(color: t.colorScheme.error)),
            ),
          const SizedBox(height: 16),
          FilledButton(
            key: const Key('gym-submit'),
            onPressed: _busy || !_valid ? null : _submit,
            child: _busy ? const SizedBox.square(dimension: 22, child: CircularProgressIndicator(strokeWidth: 2)) : Text(l.gymSubmit),
          ),
          const SizedBox(height: 24),
        ],
      ),
    );
  }
}
