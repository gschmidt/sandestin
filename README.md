_"I first generate a phantasm, a perfect visualization of the completed building. After which I employ one of the minor sandestins, of the type called ‘madlings,’ who builds the structure in a matter of hours, flying in the materials from anywhere in the chronosphere wherein they may be found."_

### Overview

This is the code repo for Dragon Egg [http://dragonegg.info]
To contribute, please make a Pull Request. 

### Set up the simulator
```
npm install
pip3 install matplotlib
```

### Run the simulator
```
node app.js
```

### Change the patterns

In `app.js`, find the line that looks like
```
let instrument = new Instrument(model, framesPerSecond, 'python3', [path.join(pathToRootOfTree(), 'patterns', 'top_down_white.py')]);
```
Instrument is essentially calling a subprocess that calls a pattern generation program, which will print each frame's frame id and all color RGBA values to the STDOUT, and the main program will send this frame information to the light controller. 
To change the patterns, you can change the subprocess command. For example, if you want to run rainbow_spot.js, change "python3" to "node", and change the pattern program "top_down_white.py" to "rainbow_spot.js". 


### Make patterns

Please reference the existing programs that generate patterns. 
Each program takes a model file as input, which describes the Dragon Egg's geometry, the nodes, edges, and pixels (3d coordinates). Each program should output frame id and pixel RGBA values frame by frame in byte stream. 

