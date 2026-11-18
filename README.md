# HEPTA-SAT XBee Setup

## Before you connect

| Device | What to do before using the web app |
| --- | --- |
| Ground station | Plug the USB XBee into your PC. No firmware upload is needed. |
| Satellite with the joint-network Lab5-07 sketch or another sketch with its USB setup service | Power the satellite and connect its onboard computer (OBC) by USB. It is ready to use. |
| Satellite running a legacy sketch without the USB setup service | First [build and upload the joint-network sketch](examples/README.md#build-the-joint-network-sample) to the **satellite OBC** using Arduino IDE. This replaces the sketch currently on the OBC. |

The web app changes network settings. Joining or restoring a network does not require another upload. The supported S2C Zigbee XBee modules on both ends keep their existing radio firmware.

## Join or restore a network

[Open XBee network setup](https://hepta-sat-training.github.io/HEPTA-SAT-XBee-Setup/) in desktop Chrome or Edge. Close any serial monitor using the device's port.

1. Select **Read host ground station via USB**. Keep that station powered. Use **Enter settings manually** if you already know the destination network ID and channel.
2. Choose **Satellite** or **Ground station**, then **Connect device via USB**. Select **Review network change** and **Join network**.
3. To return, reconnect the device in the same browser and select **Restore original network**. If both a ground station and its satellite moved, restore the ground station first.

The ground station uses Transparent mode at 38400 baud. The host must permit joining. Settings are read over local USB. Original settings are kept in this browser by radio address. A different site origin, including localhost, has its own restore records.

## Send and receive

After setup, disconnect the ground station's port here and open it in the [Web Serial Monitor](https://hepta-sat-training.github.io/HEPTA-SAT-Serial_Monitor/) at **38400 baud**, **Text** view. See the [communication examples](examples/README.md) for commands, Arduino code and expected output for each route.

## Local use and tests

Serve the static files with `python -m http.server 8000 --bind 127.0.0.1 --directory docs`, then open `http://localhost:8000/`. GitHub Pages serves the same directory from the main branch.

Run `npm test` for the radio protocol checks. With Python Playwright and Chromium installed, run `python tools/verify_lab_ui.py` for the simulated-device browser test.
