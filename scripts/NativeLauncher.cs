using System;
using System.IO;
using System.Diagnostics;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Collections.Generic;
class NativeLauncher {
  static int Main(string[] args) {
    try {
      var root = AppDomain.CurrentDomain.BaseDirectory;
      var json = new JavaScriptSerializer();
      var config = json.Deserialize<Dictionary<string,string>>(File.ReadAllText(Path.Combine(root,"launcher.json")));
      if (args.Length == 0 || args[0] != config["origin"]) return 2;
      if (!File.Exists(config["node"]) || !File.Exists(config["bridge"]) || !Directory.Exists(config["root"])) {
        Console.Error.WriteLine("POLARION_NATIVE_INSTALLATION_INCOMPLETE"); return 3;
      }
      var start = new ProcessStartInfo(config["node"], "\"" + config["bridge"] + "\"") {
        UseShellExecute=false, CreateNoWindow=true, RedirectStandardInput=true,
        RedirectStandardOutput=true, RedirectStandardError=true, WorkingDirectory=config["root"]
      };
      if (config.ContainsKey("data")) start.EnvironmentVariables["POLARION_SIDEBAR_DATA"] = config["data"];
      if (config.ContainsKey("claude")) start.EnvironmentVariables["POLARION_SIDEBAR_CLAUDE"] = config["claude"];
      if (config.ContainsKey("credentials")) start.EnvironmentVariables["POLARION_SIDEBAR_CREDENTIALS"] = config["credentials"];
      // SDK launches of JavaScript CLIs use `node`; keep them on this verified
      // private runtime without changing the user's global PATH.
      start.EnvironmentVariables["PATH"] = Path.GetDirectoryName(config["node"]) + Path.PathSeparator + (start.EnvironmentVariables["PATH"] ?? "");
      using (var child = Process.Start(start)) {
        var errors = child.StandardError.ReadToEndAsync();
        var incoming = Task.Run(async () => {
          var input = Console.OpenStandardInput(); var buffer = new byte[8192]; int count;
          while ((count = await input.ReadAsync(buffer,0,buffer.Length)) > 0) {
            await child.StandardInput.BaseStream.WriteAsync(buffer,0,count);
            await child.StandardInput.BaseStream.FlushAsync();
          }
          child.StandardInput.Close();
        });
        child.StandardOutput.BaseStream.CopyTo(Console.OpenStandardOutput());
        child.WaitForExit(); return child.ExitCode;
      }
    } catch (Exception error) { Console.Error.WriteLine("POLARION_NATIVE_START_FAILED:" + error.GetType().Name); return 1; }
  }
}
