# HEPTA-SAT XBee Setup

[Open XBee network setup](https://hepta-sat-training.github.io/HEPTA-SAT-XBee-Setup/) in desktop Chrome or Edge. Connect a ground station or satellite by USB. Close any serial monitor using its port.

1. Select **Read host ground station via USB**. Keep that station powered. Use **Enter settings manually** if you already know the destination network ID and channel.
2. Choose **Satellite** or **Ground station**, then **Connect device via USB**. Select **Review network change** and **Join network**.
3. To return, reconnect the device in the same browser and select **Restore original network**. If both a ground station and its satellite moved, restore the ground station first.

The app supports S2C Zigbee radios. The ground station uses Transparent mode at 38400 baud. Satellites need a powered OBC running the USB configuration service from the joint-network edition of Lab5-07. The host must permit joining. Settings are read over local USB. Original settings are kept in this browser by radio address. A different site origin, including localhost, has its own restore records.

## Send and receive

After setup, disconnect the ground station's port here and open it in the [Web Serial Monitor](https://hepta-sat-training.github.io/HEPTA-SAT-Serial_Monitor/) at **38400 baud**, **Text** view. See the [communication examples](examples/README.md) for commands, Arduino code and expected output for each route.

## Local use and tests

Serve the static files with `python -m http.server 8000 --bind 127.0.0.1 --directory docs`, then open `http://localhost:8000/`. GitHub Pages serves the same directory from the main branch.

Run `npm test` for the radio protocol checks. With Python Playwright and Chromium installed, run `python tools/verify_lab_ui.py` for the simulated-device browser test.
