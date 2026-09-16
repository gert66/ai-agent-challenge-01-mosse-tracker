# Exacte challenge-prompt

Bouw een verzorgde browserapp waarmee een gebruiker in het eerste frame van een video één object kan selecteren, bijvoorbeeld een auto, persoon of dier. De applicatie moet dit object daarna automatisch blijven volgen door de video heen en het resultaat duidelijk visualiseren.

Gebruik de meegeleverde testvideo’s. Toon minimaal een bounding box, het gevolgde traject, een indicatie van trackingkwaliteit of confidence en herkenning van momenten waarop het object tijdelijk verloren raakt en eventueel weer wordt teruggevonden. Verwerk meerdere video’s, inclusief camerabeweging of gedeeltelijke occlusie.

Maak de applicatie visueel sterk en direct begrijpelijk, met een nette layout, duidelijke controls en soepele visualisatie. Het resultaat moet morgenochtend zonder extra handwerk direct demonstreerbaar zijn.

Werk volledig autonoom. Gebruik de meegeleverde context en publieke bronnen, kies zelf geschikte libraries en technieken, test de belangrijkste gebruikersflow end-to-end, laat een review uitvoeren en verbeter het resultaat totdat de belangrijkste acceptance criteria zijn gehaald.

Werk na de start zonder menselijke interventie. Stel geen niet-essentiële vragen. Als een gekozen aanpak of dependency niet beschikbaar is, kies zelfstandig een veilige alternatieve route en ga door. Gebruik geen sudo/root en wijzig geen bestaande productieomgevingen. Lever volledige broncode, tests, documentatie en een kort eindrapport op.

# Acceptance criteria
- Meegeleverde video’s laden en afspelen.
- Doelgebied in het eerste frame kunnen selecteren.
- Bounding box, traject en status/confidence zichtbaar maken.
- Easy synthetic test correct verwerken.
- Occlusion/camera-motion test verwerken en verlies/herstel zichtbaar maken waar relevant.
- Publieke OpenCV-video zonder crash verwerken.
- Minimaal één kwantitatieve metric tonen, zoals tracked-frame percentage, fps of localization error.