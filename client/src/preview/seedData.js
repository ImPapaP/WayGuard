// Demo data for the in-browser preview (same records as server/scripts/seed-demo.js).

export const AGENCIES = [
  ['City Engineering Office (Demo)', 'city_municipal', 'engineering@demo.wayguard.test', '(044) 000 0001'],
  ['DPWH District Engineering Office (Demo)', 'national', 'dpwh@demo.wayguard.test', '(044) 000 0002'],
  ['Provincial Engineering Office (Demo)', 'provincial', null, '(044) 000 0003'],
  ['Barangay Road Maintenance (Demo)', 'barangay', null, null],
];

export const USERS = [
  ['admin', 'Ana Reyes', 'admin', null],
  ['admin2', 'Carlo Bautista', 'admin', null],
  ['crew.alpha', 'Ramon Cruz', 'maintenance', 'Road Crew Alpha'],
  ['crew.bravo', 'Lito Garcia', 'maintenance', 'Road Crew Bravo'],
  ['maria', 'Maria Santos', 'citizen', null],
  ['juan', 'Juan Dela Cruz', 'citizen', null],
  ['liza', 'Liza Mendoza', 'citizen', null],
];

// [reporter, status, days ago, severity, road, barangay, landmark, lat, lng, road type, hazards, extra]
export const REPORTS = [
  ['maria', 'submitted', 0.2, 'high', 'Paseo del Congreso', 'Catmon', 'In front of the cathedral gate', 14.84352, 120.81152, 'city_municipal', ['deep', 'motorcycle_risk']],
  ['juan', 'submitted', 0.6, 'high', 'Paseo del Congreso', 'Catmon', 'Across the cathedral', 14.84361, 120.81160, 'city_municipal', ['deep']],
  ['liza', 'submitted', 1.1, 'medium', 'MacArthur Highway', 'Longos', 'Near the jeepney terminal', 14.85305, 120.81972, 'national', ['wide', 'causes_swerving']],
  ['maria', 'submitted', 1.8, 'low', 'Mabini Street', 'Santo Niño', 'Beside the sari-sari store', 14.84187, 120.80945, 'barangay', []],
  ['juan', 'submitted', 2.4, 'medium', 'Gov. F. Halili Avenue', 'Mojon', 'Corner of the gas station', 14.86240, 120.81655, 'provincial', ['water_filled']],
  ['liza', 'under_review', 3.0, 'high', 'Bulihan Road', 'Bulihan', 'Near the elementary school', 14.86975, 120.82410, 'city_municipal', ['near_school_or_crossing', 'deep']],
  ['maria', 'under_review', 3.5, 'medium', 'Sumapang Matanda Road', 'Sumapang Matanda', 'Beside the covered court', 14.85640, 120.81020, 'barangay', ['poor_lighting']],
  ['juan', 'under_review', 4.2, 'low', 'Santo Rosario Street', 'Santo Rosario', 'Near the plaza', 14.84630, 120.80860, 'city_municipal', []],
  ['liza', 'verified', 5.0, 'high', 'MacArthur Highway', 'Tikay', 'Southbound lane by the overpass', 14.85960, 120.82815, 'national', ['deep', 'damaged_vehicles']],
  ['maria', 'verified', 6.5, 'medium', 'Pinagbakahan Road', 'Pinagbakahan', 'Near the barangay hall', 14.86630, 120.80520, 'barangay', ['water_filled']],
  ['juan', 'verified', 7.0, 'low', 'Caingin Road', 'Caingin', 'Before the bridge', 14.83620, 120.81800, 'city_municipal', []],
  ['maria', 'assigned', 8.0, 'high', 'Paseo del Congreso', 'San Gabriel', 'Barasoain Church side street', 14.84660, 120.81255, 'city_municipal', ['deep', 'motorcycle_risk'], { team: 'Road Crew Alpha', due: 5 }],
  ['liza', 'assigned', 9.0, 'medium', 'Guinhawa Road', 'Guinhawa', 'Near the rice mill', 14.85180, 120.80310, 'city_municipal', ['wide'], { team: 'Road Crew Bravo', due: 7 }],
  ['juan', 'assigned', 10.0, 'medium', 'Dakila Road', 'Dakila', 'Beside the chapel', 14.85875, 120.79905, 'barangay', [], { team: 'Road Crew Alpha', due: 10 }],
  ['maria', 'in_progress', 12.0, 'high', 'MacArthur Highway', 'Mojon', 'Near the mall entrance', 14.86415, 120.82155, 'national', ['deep', 'causes_swerving'], { team: 'Road Crew Alpha', due: 2, progress: true }],
  ['juan', 'in_progress', 13.0, 'medium', 'Atlag Road', 'Atlag', 'Beside the health center', 14.83150, 120.81320, 'city_municipal', ['water_filled'], { team: 'Road Crew Bravo', due: 3, progress: true }],
  ['liza', 'in_progress', 15.0, 'medium', 'Look 1st Road', 'Look 1st', 'Near the basketball court', 14.84050, 120.82480, 'barangay', [], { team: 'Road Crew Alpha', due: -1, progress: true, completed: true }],
  ['maria', 'resolved', 25.0, 'high', 'Paseo del Congreso', 'Catmon', 'Near the municipal hall', 14.84380, 120.81090, 'city_municipal', ['deep'], { team: 'Road Crew Alpha', resolvedAfter: 9, rating: 5, comment: 'Fixed within two weeks. Thank you!' }],
  ['juan', 'resolved', 40.0, 'medium', 'Bulihan Road', 'Bulihan', 'Front of the subdivision gate', 14.86880, 120.82110, 'city_municipal', ['wide'], { team: 'Road Crew Bravo', resolvedAfter: 12, rating: 4, comment: 'Good patch but the edges are a bit rough.' }],
  ['liza', 'resolved', 55.0, 'low', 'Mabini Street', 'Santo Niño', 'Near the bakery', 14.84120, 120.81030, 'barangay', [], { team: 'Road Crew Alpha', resolvedAfter: 20, rating: 3 }],
  ['maria', 'resolved', 75.0, 'high', 'MacArthur Highway', 'Longos', 'Northbound lane near the school', 14.85190, 120.81910, 'national', ['near_school_or_crossing'], { team: 'Road Crew Bravo', resolvedAfter: 6, rating: 5, comment: 'Very fast response.' }],
  ['juan', 'resolved', 100.0, 'medium', 'Gov. F. Halili Avenue', 'Mojon', 'Beside the church', 14.86110, 120.81530, 'provincial', [], { team: 'Road Crew Alpha', resolvedAfter: 15 }],
  ['liza', 'resolved', 130.0, 'medium', 'Santo Rosario Street', 'Santo Rosario', 'Corner of the pharmacy', 14.84560, 120.80790, 'city_municipal', ['water_filled'], { team: 'Road Crew Bravo', resolvedAfter: 18 }],
  ['juan', 'rejected', 20.0, 'low', 'Private Subdivision Road', 'Bulihan', 'Inside the gated village', 14.87210, 120.82690, 'private', [], { reason: 'Private subdivision road — outside LGU jurisdiction. Please contact your homeowners association.' }],
  ['maria', 'rejected', 30.0, 'medium', 'Tikay Road', 'Tikay', 'Near the poultry farm', 14.86470, 120.83400, 'barangay', [], { reason: 'Photo shows a speed bump, not road damage.' }],
  ['liza', 'duplicate', 7.5, 'high', 'Paseo del Congreso', 'San Gabriel', 'Barasoain Church side', 14.84668, 120.81262, 'city_municipal', ['deep'], { duplicateOfIndex: 11 }],
];

export const DESCRIPTIONS = {
  high: 'Large, deep pothole across most of the lane. Vehicles brake suddenly to avoid it and motorcycles have nearly fallen.',
  medium: 'Pothole about the size of a tyre. It collects water when it rains and is hard to see at night.',
  low: 'Small pothole near the edge of the road. Not dangerous yet but getting bigger.',
};
