# HEPTA-SAT XBee setup and ground station

[Open Network setup](https://hepta-sat-training.github.io/HEPTA-SAT-XBee-Setup/) · [Open API ground station](https://hepta-sat-training.github.io/HEPTA-SAT-XBee-Setup/station.html)

## Before you connect

**Satellite:** Upload [this Lab5-07 sketch](https://github.com/HEPTA-SAT-TRAINING/Lab5-07_Xbee_Api_Mode/tree/feat/zigbee-joint-lab#upload-this-sketch-to-the-satellite) to the satellite OBC using Arduino IDE. Full and Lite use the same sketch. Earlier joint-network versions already support setup and `HELLO`. Use the current version for single-character commands from another ground station.

**Ground station:** Plug the USB XBee into your PC. No upload is needed. The XBee radio firmware stays as supplied.

## Join or restore a network

[Open XBee network setup](https://hepta-sat-training.github.io/HEPTA-SAT-XBee-Setup/) in desktop Chrome or Edge. Close any serial monitor using the device's port.

1. Select **Read host ground station via USB**. Keep that station powered. Use **Enter settings manually** if you already know the destination network ID and channel.
2. Choose **Satellite** or **Ground station**, then **Connect device via USB**. Select **Review network change** and **Join network**.
3. To return, reconnect the device in the same browser and select **Restore original network**. If both a ground station and its satellite moved, restore the ground station first.

The ground station uses Transparent mode at 38400 baud. The host must permit joining. Settings are read over local USB. Original settings are kept in this browser by radio address. A different site origin, including localhost, has its own restore records.

## Send and receive

After setup, disconnect the ground station's port here and open it in the [Web Serial Monitor](https://hepta-sat-training.github.io/HEPTA-SAT-Serial_Monitor/) at **38400 baud**, **Text** view. See the [communication examples](examples/README.md) for commands, Arduino code and expected output.

For direct or broadcast messages, open **API ground station** in this app. Its toolbar, console and send bar are based on the [HEPTA-SAT Serial Monitor](https://github.com/HEPTA-SAT-TRAINING/HEPTA-SAT-Serial_Monitor).

1. Select **Select & Connect Port** and choose the ground station USB port. **Send to** starts on the paired radio. Other radios on the same network appear as they are found.
2. Choose a radio or **Broadcast · all radios**. Send `HELLO` with **EOL → None**. Each responding Lab5-07 satellite returns `ACK` with its own address in the log. [See the broadcast diagram](examples/README.md#ground-station-broadcast).
3. Select **Disconnect** to return the ground station to Transparent mode. If the tab closed early, reconnect in the API ground station and select **Disconnect**. Switching modes uses RAM and keeps the radio's network and paired address.

## Download a picture

1. Upload the [current Lab5-07 sketch](https://github.com/HEPTA-SAT-TRAINING/Lab5-07_Xbee_Api_Mode/tree/feat/zigbee-joint-lab#upload-this-sketch-to-the-satellite). Place a JPEG named `picture_dl.jpg` on the satellite microSD card, up to 1 MiB. A saved picture works without a camera.
2. In **API ground station**, select the satellite under **Send to** and click **Get picture**.
3. Click **Save JPEG** when verification finishes.

<details><summary>Development and tests</summary>

Serve the static files with `python -m http.server 8000 --bind 127.0.0.1 --directory docs`, then open `http://localhost:8000/`. GitHub Pages serves the same directory from the main branch.

Run `npm test` for the radio protocol checks. With Python Playwright and Chromium installed, run `python tools/verify_lab_ui.py` for the simulated-device browser test.

</details>
