/**
 * getPropertyTypeGroup
 *
 * 'residential' → شقق وفلل ومنازل
 *   shows: bedrooms, bathrooms, livingRooms, floor, propertyAge, isFurnished, hasElevator, hasKitchen
 *
 * 'commercial'  → محلات ومكاتب ومستودعات
 *   shows: bathrooms, floor, propertyAge, hasElevator
 *   hides: bedrooms, livingRooms
 *
 * 'land'        → أراضي
 *   shows: area, streetWidth, facade only
 *   emphasizes: hasWater, hasElectricity, hasSewage
 *
 * 'bookable'    → قاعات ومنشآت الإيجار اليومي
 *   event_hall: maxGuests, pricePerHalfDay, includedServices
 *   daily rental: maxGuests, checkInTime, checkOutTime, minNights
 */
export function getPropertyTypeGroup(
  propertyType: string,
): 'residential' | 'commercial' | 'land' | 'bookable' {
  if (['apartment', 'villa', 'house', 'floor', 'chalet', 'rest_house', 'farm'].includes(propertyType)) {
    return 'residential';
  }

  if (['shop', 'commercial_office', 'warehouse', 'building'].includes(propertyType)) {
    return 'commercial';
  }

  if (propertyType === 'land') return 'land';

  return 'bookable';
}
