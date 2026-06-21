import { Injectable } from '@nestjs/common';

@Injectable()
export class TourismService {
  /**
   * validateHostLicense
   * التحقق من رخصة المضيف السياحية
   * عبر منصة وزارة السياحة السعودية
   *
   * Validates the host's tourism license number
   * against the Ministry of Tourism database.
   *
   * Integration status: PENDING
   * TODO: Replace placeholder with real Ministry
   *       of Tourism API call when credentials available.
   *       Endpoint and auth method: TBD by Ministry team.
   *
   * @returns { isValid: boolean, message?: string }
   *   isValid: true  → license valid, proceed
   *   isValid: false → license invalid, show message
   */
  validateHostLicense(
    _tourismLicenseNumber: string,
  ): Promise<{ isValid: boolean; message?: string }> {
    // ── PLACEHOLDER ──────────────────────────────────
    // Real Ministry of Tourism API call goes here
    // For now: always returns valid for testing
    return Promise.resolve({ isValid: true });
  }
}
