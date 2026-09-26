import 'package:flutter/material.dart';

import '../l10n/l10n.dart';
import '../network/api_error.dart';

/// Maps any error to a clear, translated message (spec §19.6: never expose stack traces).
String errorMessage(BuildContext context, Object error) {
  final l = context.l10n;
  if (error is! ApiError) return l.errorGeneric;
  switch (error.kind) {
    case ApiErrorKind.network:
      return l.errorNetwork;
    case ApiErrorKind.timeout:
      return l.errorTimeout;
    case ApiErrorKind.server:
      return l.errorServer;
    case ApiErrorKind.unauthenticated:
      return error.code == 'INVALID_CREDENTIALS' ? l.errorInvalidCredentials : l.errorSession;
    case ApiErrorKind.client:
      return switch (error.code) {
        'ACCOUNT_LOCKED' => l.errorAccountLocked,
        'UNDER_AGE' => l.errorUnderAge((error.extra['minAgeYears'] as num?)?.toInt() ?? 18),
        'EMAIL_TAKEN' => l.errorEmailTaken,
        'USERNAME_TAKEN' => l.errorUsernameTaken,
        'RATE_LIMITED' => l.errorRateLimited,
        'WORKOUT_REJECTED' => l.errorWorkoutRejected,
        'VALIDATION_FAILED' => l.errorValidation,
        _ => l.errorGeneric,
      };
  }
}

class ErrorView extends StatelessWidget {
  const ErrorView({super.key, required this.error, this.onRetry});

  final Object error;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(Icons.cloud_off_rounded, size: 40, color: Theme.of(context).colorScheme.outline),
          const SizedBox(height: 12),
          Text(errorMessage(context, error), textAlign: TextAlign.center),
          if (onRetry != null) ...[
            const SizedBox(height: 16),
            OutlinedButton(onPressed: onRetry, child: Text(context.l10n.retry)),
          ],
        ]),
      ),
    );
  }
}
