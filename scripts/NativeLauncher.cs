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
      var start = new ProcessStartInfo(config["node"], "\"" + config["bridge"] + "\"") {
        UseShellExecute=false, CreateNoWindow=true, RedirectStandardInput=true,
        RedirectStandardOutput=true, RedirectStandardError=true, WorkingDirectory=config["root"]
      };
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
    } catch { return 1; }
  }
}
