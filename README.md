# HEPTA-SAT XBee Setup

## Before you connect

**Satellite:** Upload [this Lab5-07 sketch](https://github.com/HEPTA-SAT-TRAINING/Lab5-07_Xbee_Api_Mode/tree/feat/zigbee-joint-lab#upload-this-sketch-to-the-satellite) to the satellite OBC using Arduino IDE. Use the same sketch for Full and Lite. If setup already shows the satellite's radio address, skip the upload.

**Ground station:** Plug the USB XBee into your PC. No upload is needed. The XBee radio firmware stays as supplied.

## Join or restore a network

[Open XBee network setup](https://hepta-sat-training.github.io/HEPTA-SAT-XBee-Setup/) in desktop Chrome or Edge. Close any serial monitor using the device's port.

1. Select **Read host ground station via USB**. Keep that station powered. Use **Enter settings manually** if you already know the destination network ID and channel.
2. Choose **Satellite** or **Ground station**, then **Connect device via USB**. Select **Review network change** and **Join network**.
3. To return, reconnect the device in the same browser and select **Restore original network**. If both a ground station and its satellite moved, restore the ground station first.

The ground station uses Transparent mode at 38400 baud. The host must permit joining. Settings are read over local USB. Original settings are kept in this browser by radio address. A different site origin, including localhost, has its own restore records.

## Send and receive

After setup, disconnect the ground station's port here and open it in the [Web Serial Monitor](https://hepta-sat-training.github.io/HEPTA-SAT-Serial_Monitor/) at **38400 baud**, **Text** view. See the [communication examples](examples/README.md) for commands, Arduino code and expected output.

**One recipient per message.** A typed command goes to the paired satellite. `TO <address>` tells that satellite to send `HELLO` to one more radio on the same network. Sending one command to every satellite at once (broadcast) is not supported by this sketch.

<details><summary>Development and tests</summary>

Serve the static files with `python -m http.server 8000 --bind 127.0.0.1 --directory docs`, then open `http://localhost:8000/`. GitHub Pages serves the same directory from the main branch.

Run `npm test` for the radio protocol checks. With Python Playwright and Chromium installed, run `python tools/verify_lab_ui.py` for the simulated-device browser test.

</details>
