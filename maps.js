// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ASA RIDE — Google Maps Integration
// index.html ke <head> mein add karo:
// <script src="maps.js"></script>
// <script async src="https://maps.googleapis.com/maps/api/js?key=YOUR_KEY&callback=initMap&libraries=places"></script>
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

var gMap = null, pickupMarker = null, dropMarker = null, routeLine = null;
var directionsService = null, directionsRenderer = null;

// Main map init — Google calls this automatically
function initMap() {
  // Default center — India center
  var india = { lat: 20.5937, lng: 78.9629 };

  gMap = new google.maps.Map(document.getElementById('google-map'), {
    zoom: 5,
    center: india,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
    zoomControl: true,
    styles: [
      { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
      { featureType: 'transit', stylers: [{ visibility: 'off' }] }
    ]
  });

  directionsService = new google.maps.DirectionsService();
  directionsRenderer = new google.maps.DirectionsRenderer({
    map: gMap,
    suppressMarkers: true,
    polylineOptions: { strokeColor: '#1B8A5A', strokeWeight: 5, strokeOpacity: 0.8 }
  });

  // Autocomplete for pickup & drop inputs
  setupAutocomplete('pickup', 'drop');

  // Try GPS immediately
  getUserLocation();
}

// Autocomplete
function setupAutocomplete(pickupId, dropId) {
  var pickupInput = document.getElementById(pickupId);
  var dropInput = document.getElementById(dropId);
  if (!pickupInput || !dropInput) return;

  var options = { componentRestrictions: { country: 'in' }, fields: ['geometry', 'formatted_address', 'name'] };

  var pickupAC = new google.maps.places.Autocomplete(pickupInput, options);
  var dropAC = new google.maps.places.Autocomplete(dropInput, options);

  pickupAC.addListener('place_changed', () => {
    var place = pickupAC.getPlace();
    if (place.geometry) {
      setPickupLocation(place.geometry.location.lat(), place.geometry.location.lng(), place.formatted_address || place.name);
    }
  });

  dropAC.addListener('place_changed', () => {
    var place = dropAC.getPlace();
    if (place.geometry) {
      setDropLocation(place.geometry.location.lat(), place.geometry.location.lng(), place.formatted_address || place.name);
    }
  });
}

// Set pickup on map
function setPickupLocation(lat, lng, address) {
  var pos = { lat: parseFloat(lat), lng: parseFloat(lng) };

  if (pickupMarker) pickupMarker.setMap(null);
  pickupMarker = new google.maps.Marker({
    position: pos,
    map: gMap,
    icon: { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 48" width="32" height="48"><circle cx="16" cy="16" r="14" fill="#1B8A5A" stroke="#fff" stroke-width="3"/><text x="16" y="21" text-anchor="middle" font-size="14">📍</text><line x1="16" y1="30" x2="16" y2="48" stroke="#1B8A5A" stroke-width="3"/></svg>'), scaledSize: new google.maps.Size(32, 48) },
    title: 'Pickup: ' + address,
    animation: google.maps.Animation.DROP
  });

  var inp = document.getElementById('pickup');
  if (inp) inp.value = address;

  gMap.panTo(pos);
  gMap.setZoom(14);

  if (dropMarker) calcRoute();
}

// Set drop on map
function setDropLocation(lat, lng, address) {
  var pos = { lat: parseFloat(lat), lng: parseFloat(lng) };

  if (dropMarker) dropMarker.setMap(null);
  dropMarker = new google.maps.Marker({
    position: pos,
    map: gMap,
    icon: { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 48" width="32" height="48"><circle cx="16" cy="16" r="14" fill="#F38B00" stroke="#fff" stroke-width="3"/><text x="16" y="21" text-anchor="middle" font-size="14">🏁</text><line x1="16" y1="30" x2="16" y2="48" stroke="#F38B00" stroke-width="3"/></svg>'), scaledSize: new google.maps.Size(32, 48) },
    title: 'Drop: ' + address,
    animation: google.maps.Animation.DROP
  });

  var inp = document.getElementById('drop');
  if (inp) inp.value = address;

  if (pickupMarker) calcRoute();
}

// Calculate route & distance
function calcRoute() {
  if (!pickupMarker || !dropMarker || !directionsService) return;

  directionsService.route({
    origin: pickupMarker.getPosition(),
    destination: dropMarker.getPosition(),
    travelMode: google.maps.TravelMode.DRIVING,
    region: 'IN'
  }, (result, status) => {
    if (status === 'OK') {
      directionsRenderer.setDirections(result);
      var leg = result.routes[0].legs[0];
      var km = leg.distance.value / 1000;
      var dur = leg.duration.text;

      // Update map info
      var distEl = document.getElementById('map-dist-txt');
      if (distEl) distEl.textContent = km.toFixed(1) + ' km · ' + dur;

      // Update fare with real distance
      calcFareWithKm(km);

      // Fit map to route
      var bounds = new google.maps.LatLngBounds();
      bounds.extend(pickupMarker.getPosition());
      bounds.extend(dropMarker.getPosition());
      gMap.fitBounds(bounds);
    }
  });
}

// Real fare calculation with actual km
function calcFareWithKm(km) {
  var rates = { AUTO: 13, BIKE: 9, CAB: 18, ER: 11 };
  var discounts = { AUTO: 15, BIKE: 15, CAB: 20, ER: 15 };
  var veh = window.bVeh || 'AUTO';
  var dist = km + 0.02; // +20m rule
  var base = Math.round((rates[veh] || 13) * dist);
  var disc = Math.round(base * (discounts[veh] || 15) / 100);
  var total = base - disc;

  var updates = {
    'fare-dist': dist.toFixed(1) + ' km',
    'base-fare': '₹' + base,
    'disc-amt': '-₹' + disc + ' (' + (discounts[veh] || 15) + '% off)',
    'total-fare': '₹' + total,
    'pay-final': '₹' + total,
    'map-dist-txt': km.toFixed(1) + ' km'
  };
  Object.entries(updates).forEach(([id, val]) => {
    var el = document.getElementById(id);
    if (el) el.textContent = val;
  });
}

// GPS location
function getUserLocation() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(pos => {
    var lat = pos.coords.latitude, lng = pos.coords.longitude;

    // Reverse geocode
    var geocoder = new google.maps.Geocoder();
    geocoder.geocode({ location: { lat, lng } }, (results, status) => {
      if (status === 'OK' && results[0]) {
        var address = results[0].formatted_address;
        setPickupLocation(lat, lng, address);
        var ml = document.getElementById('map-loc-txt');
        if (ml) ml.textContent = '📍 ' + address.substring(0, 45) + '...';
      }
    });
  }, () => {
    console.log('GPS permission denied — manual entry');
  });
}

// Export for use in main site
window.initMap = initMap;
window.getUserLocation = getUserLocation;
window.setPickupLocation = setPickupLocation;
window.setDropLocation = setDropLocation;
